import { useCallback, useEffect, useState } from 'react';
import { clipEndBeat, makeClip, makeTrack } from '../../arrange/project';
import { createProject, getProject, listProjects } from '../../arrange/projectsApi';
import { editProject } from '../../samplesApi';

// Written by the Arrange screen whenever a project is opened.
const LAST_PROJECT_KEY = 'arrange:lastProject';

function lastProjectId() {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch (e) {
    return null;
  }
}

/** Where the sample's clip goes: the next bar after everything else (beat 0 when empty). */
function appendBeat(project) {
  const bpb = project.beats_per_bar || 4;
  let end = 0;
  for (const track of project.tracks || []) {
    for (const clip of track.clips || []) {
      const sample = project.samples?.[clip.sample_id];
      // A clip whose sample isn't embedded still counts from its start.
      end = Math.max(end, sample ? clipEndBeat(clip, sample, project.bpm) : clip.start_beat);
    }
  }
  return Math.ceil(end / bpb - 1e-6) * bpb;
}

/**
 * The Arrange project the Library works with: the last one opened there
 * (localStorage), else the most recent. Gives its tempo to "Sync" previews
 * and receives "Add to Arrange". { project: {id, name, bpm} | null, addSample }
 */
export default function useProjectTarget() {
  const [project, setProject] = useState(null);

  const resolve = useCallback(async () => {
    const id = lastProjectId();
    if (id) {
      try {
        const res = await getProject(id);
        return res.data;
      } catch (e) {
        // deleted since - fall through to the newest one
      }
    }
    const res = await listProjects();
    const list = res.data?.projects || [];
    if (!list.length) return null;
    const newest = [...list].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
    return { id: newest.id, name: newest.name, bpm: newest.bpm };
  }, []);

  const reload = useCallback(async () => {
    try {
      const p = await resolve();
      setProject(p ? { id: p.id, name: p.name, bpm: p.bpm } : null);
    } catch (e) {
      setProject(null);
    }
  }, [resolve]);

  useEffect(() => {
    reload();
    // Arrange in another tab may change the last project / its tempo.
    const onStorage = (e) => e.key === LAST_PROJECT_KEY && reload();
    const onFocus = () => reload();
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
    };
  }, [reload]);

  /**
   * New track named after the sample with one clip, after the last clip.
   * Resolves { project: {id, name}, bar, created }.
   */
  const addSample = useCallback(
    async (sample) => {
      let target = project || (await resolve());
      let created = false;
      if (!target) {
        target = (await createProject({ name: 'Library picks' })).data;
        created = true;
      }
      let bar = 1;
      const saved = await editProject(target.id, (doc) => {
        const beat = appendBeat(doc);
        bar = beat / (doc.beats_per_bar || 4) + 1;
        const track = { ...makeTrack(sample.name.slice(0, 200)), clips: [makeClip(sample, beat)] };
        // A fresh project starts with one empty "Track 1": fill it instead
        // of leaving it dangling above the sample's track.
        const tracks = doc.tracks || [];
        const reuse = created && tracks.length === 1 && !tracks[0].clips?.length;
        return { ...doc, tracks: reuse ? [{ ...tracks[0], name: track.name, clips: track.clips }] : [...tracks, track] };
      });
      setProject({ id: saved.id, name: saved.name, bpm: saved.bpm });
      return { project: { id: saved.id, name: saved.name }, bar, created };
    },
    [project, resolve]
  );

  return { project, addSample, reload };
}
