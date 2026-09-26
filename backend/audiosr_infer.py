"""
Standalone AudioSR inference wrapper.

Replaces driving the `audiosr` CLI once per stem. The CLI can't report
per-file progress and re-loads its (large) latent diffusion model on every
invocation, so this wrapper mirrors what the CLI's `__main__` does — same
`build_model` / `super_resolution` / `save_wave` calls, same defaults
(seed 42, 48kHz, latent_t_per_second 12.8, "high" matmul precision) — but
loads the model once for all of a job's stems (see infer_cli.py).

Output is identical to the CLI's: `save_wave` writes the first (and only)
channel, so stereo input stems still come out mono, a constraint of
upstream AudioSR rather than this integration.
"""
import os
from pathlib import Path

import torch

import infer_cli

os.environ.setdefault("TOKENIZERS_PARALLELISM", "true")

from audiosr import build_model, save_wave, super_resolution  # noqa: E402

SAMPLE_RATE = 48000
LATENT_T_PER_SECOND = 12.8
SEED = 42


def main():
    parser = infer_cli.build_parser("Restore audio stems with AudioSR (model loaded once for all stems).")
    parser.add_argument("--model_name", default="basic", choices=["basic", "speech"])
    parser.add_argument("--ddim_steps", type=int, default=50)
    parser.add_argument("--guidance_scale", type=float, default=3.5)
    args = parser.parse_args()

    device = args.device if (args.device == "cpu" or torch.cuda.is_available()) else "cpu"

    torch.set_float32_matmul_precision("high")
    model = build_model(model_name=args.model_name, device=device)

    def restore_one(in_wav: str, out_wav: str) -> None:
        waveform = super_resolution(
            model,
            in_wav,
            seed=SEED,
            guidance_scale=args.guidance_scale,
            ddim_steps=args.ddim_steps,
            latent_t_per_second=LATENT_T_PER_SECOND,
        )
        out = Path(out_wav)
        # save_wave names the file "<name>.wav" inside savepath for a
        # single-item batch, so this lands exactly at out_wav.
        save_wave(waveform, inputpath=in_wav, savepath=str(out.parent), name=out.stem, samplerate=SAMPLE_RATE)

    infer_cli.run_batch(args.in_wav, args.out_wav, restore_one)


if __name__ == "__main__":
    main()
