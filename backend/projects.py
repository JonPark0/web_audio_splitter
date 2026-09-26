"""
Arrangement projects: tracks of library-sample clips on a beat timeline.

The client edits the whole document locally and saves it with one PUT
(debounced autosave), which replaces tracks and clips in a single
transaction — simpler than per-clip endpoints, and it gives undo/redo for
free on the client side. Track and clip ids are client-generated UUIDs.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import delete, func, select

from db import session_scope
from models import Clip, Project, ProjectTrack, Sample
from task_store import parse_id

router = APIRouter(prefix="/projects", tags=["projects"])

DEFAULT_BPM = 120.0


class ClipIn(BaseModel):
    id: uuid.UUID
    sample_id: uuid.UUID
    start_beat: float = Field(ge=0)
    offset_sec: float = Field(default=0, ge=0)
    length_sec: float = Field(gt=0)
    warp: bool = False
    semitones: int = Field(default=0, ge=-24, le=24)
    gain: float = Field(default=1.0, ge=0, le=4)


class TrackIn(BaseModel):
    id: uuid.UUID
    name: str = Field(min_length=1, max_length=200)
    volume: float = Field(default=1.0, ge=0, le=2)
    pan: float = Field(default=0.0, ge=-1, le=1)
    muted: bool = False
    soloed: bool = False
    clips: list[ClipIn] = []


class LoopIn(BaseModel):
    enabled: bool = False
    start_beat: float = Field(default=0, ge=0)
    end_beat: float = Field(default=16, gt=0)

    @model_validator(mode="after")
    def _ordered(self):
        if self.end_beat <= self.start_beat:
            raise ValueError("loop end_beat must be after start_beat")
        return self


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    bpm: float = Field(ge=20, le=999)
    beats_per_bar: int = Field(default=4, ge=1, le=16)
    loop: LoopIn = LoopIn()
    tracks: list[TrackIn] = []


class ProjectCreate(BaseModel):
    name: Optional[str] = None
    bpm: Optional[float] = Field(default=None, ge=20, le=999)


def _effective_bpm(sample: Sample) -> Optional[float]:
    return sample.bpm_override if sample.bpm_override is not None else sample.bpm_detected


def _sample_summary(s: Sample) -> dict:
    return {
        "id": str(s.id),
        "name": s.name,
        "duration_sec": s.duration_sec,
        "bpm": _effective_bpm(s),
        "key": s.key_override or s.key_detected,
        "audio_url": f"/samples/{s.id}/audio",
    }


def _serialize(session, project: Project) -> dict:
    tracks = session.scalars(
        select(ProjectTrack).where(ProjectTrack.project_id == project.id).order_by(ProjectTrack.position)
    ).all()
    clips = session.scalars(
        select(Clip).where(Clip.track_id.in_([t.id for t in tracks])).order_by(Clip.start_beat)
    ).all() if tracks else []
    sample_ids = {c.sample_id for c in clips}
    samples = session.scalars(select(Sample).where(Sample.id.in_(sample_ids))).all() if sample_ids else []

    clips_by_track: dict[uuid.UUID, list[dict]] = {}
    for c in clips:
        clips_by_track.setdefault(c.track_id, []).append({
            "id": str(c.id),
            "sample_id": str(c.sample_id),
            "start_beat": c.start_beat,
            "offset_sec": c.offset_sec,
            "length_sec": c.length_sec,
            "warp": c.warp,
            "semitones": c.semitones,
            "gain": c.gain,
        })

    return {
        "id": str(project.id),
        "name": project.name,
        "bpm": project.bpm,
        "beats_per_bar": project.beats_per_bar,
        "loop": {
            "enabled": project.loop_enabled,
            "start_beat": project.loop_start_beat,
            "end_beat": project.loop_end_beat,
        },
        "tracks": [
            {
                "id": str(t.id),
                "name": t.name,
                "volume": t.volume,
                "pan": t.pan,
                "muted": t.muted,
                "soloed": t.soloed,
                "clips": clips_by_track.get(t.id, []),
            }
            for t in tracks
        ],
        "samples": {str(s.id): _sample_summary(s) for s in samples},
        "created_at": project.created_at.isoformat() if project.created_at else None,
        "updated_at": project.updated_at.isoformat() if project.updated_at else None,
    }


def _get_or_404(session, project_id: str) -> Project:
    pid = parse_id(project_id)
    project = session.get(Project, pid) if pid else None
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.get("")
def list_projects():
    track_count = (
        select(func.count()).where(ProjectTrack.project_id == Project.id).correlate(Project).scalar_subquery()
    )
    clip_count = (
        select(func.count())
        .select_from(Clip)
        .join(ProjectTrack, Clip.track_id == ProjectTrack.id)
        .where(ProjectTrack.project_id == Project.id)
        .correlate(Project)
        .scalar_subquery()
    )
    stmt = select(Project, track_count, clip_count).order_by(Project.updated_at.desc())
    with session_scope() as session:
        return {
            "projects": [
                {
                    "id": str(p.id),
                    "name": p.name,
                    "bpm": p.bpm,
                    "track_count": tc,
                    "clip_count": cc,
                    "updated_at": p.updated_at.isoformat() if p.updated_at else None,
                }
                for p, tc, cc in session.execute(stmt)
            ]
        }


@router.post("", status_code=201)
def create_project(body: ProjectCreate):
    with session_scope() as session:
        count = session.scalar(select(func.count()).select_from(Project)) or 0
        project = Project(
            name=(body.name or "").strip() or f"Project {count + 1}",
            bpm=round(body.bpm, 2) if body.bpm else DEFAULT_BPM,
        )
        session.add(project)
        session.flush()
        session.add(ProjectTrack(id=uuid.uuid4(), project_id=project.id, position=0, name="Track 1"))
        session.flush()
        session.refresh(project)
        return _serialize(session, project)


@router.get("/{project_id}")
def get_project(project_id: str):
    with session_scope() as session:
        return _serialize(session, _get_or_404(session, project_id))


@router.put("/{project_id}")
def save_project(project_id: str, body: ProjectIn):
    track_ids = [t.id for t in body.tracks]
    clip_ids = [c.id for t in body.tracks for c in t.clips]
    if len(set(track_ids)) != len(track_ids) or len(set(clip_ids)) != len(clip_ids):
        raise HTTPException(status_code=400, detail="Duplicate track or clip id")

    with session_scope() as session:
        project = _get_or_404(session, project_id)

        sample_ids = {c.sample_id for t in body.tracks for c in t.clips}
        samples = {s.id: s for s in session.scalars(select(Sample).where(Sample.id.in_(sample_ids)))} if sample_ids else {}
        missing = sample_ids - samples.keys()
        if missing:
            raise HTTPException(status_code=400, detail=f"Unknown sample id(s): {', '.join(map(str, missing))}")

        # Ids are client-generated: refuse ids that belong to another
        # project rather than letting the replace below steal them.
        foreign = session.scalars(
            select(ProjectTrack.id).where(ProjectTrack.id.in_(track_ids), ProjectTrack.project_id != project.id)
        ).first() if track_ids else None
        if foreign is None and clip_ids:
            foreign = session.scalars(
                select(Clip.id)
                .join(ProjectTrack, Clip.track_id == ProjectTrack.id)
                .where(Clip.id.in_(clip_ids), ProjectTrack.project_id != project.id)
            ).first()
        if foreign is not None:
            raise HTTPException(status_code=400, detail="Track or clip id belongs to another project")

        project.name = body.name.strip()
        project.bpm = round(body.bpm, 2)
        project.beats_per_bar = body.beats_per_bar
        project.loop_enabled = body.loop.enabled
        project.loop_start_beat = body.loop.start_beat
        project.loop_end_beat = body.loop.end_beat

        session.execute(delete(ProjectTrack).where(ProjectTrack.project_id == project.id))
        for position, t in enumerate(body.tracks):
            session.add(ProjectTrack(
                id=t.id, project_id=project.id, position=position, name=t.name.strip(),
                volume=t.volume, pan=t.pan, muted=t.muted, soloed=t.soloed,
            ))
        session.flush()
        for t in body.tracks:
            for c in t.clips:
                sample = samples[c.sample_id]
                # Trim can't exceed the source audio; warp needs a sample BPM.
                offset = min(c.offset_sec, max(sample.duration_sec - 0.01, 0))
                session.add(Clip(
                    id=c.id, track_id=t.id, sample_id=c.sample_id, start_beat=c.start_beat,
                    offset_sec=offset, length_sec=min(c.length_sec, sample.duration_sec - offset),
                    warp=c.warp and _effective_bpm(sample) is not None,
                    semitones=c.semitones, gain=c.gain,
                ))
        session.flush()
        # The document changed even if only child rows did.
        project.updated_at = func.now()
        session.flush()
        session.refresh(project)
        return _serialize(session, project)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str):
    with session_scope() as session:
        session.delete(_get_or_404(session, project_id))
    return Response(status_code=204)
