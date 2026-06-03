# App sounds

Ganbaru AI uses short sound effects for notifications and attention surfaces: event notifications, Pomodoro idle alerts, focus failure, break start and finish, Pomodoro completion, and later AI response completion.

This doc defines the asset format and playback rules. The goal is predictable sound quality across the Rust notification path and the local media player path.

## Asset format

Packaged app sound assets live in `apps/client/static/sfx/`.

Every packaged app sound must be:

- WAV container.
- PCM signed 16-bit little endian audio.
- Stereo.
- 48 kHz sample rate.

The original downloaded Freesound files are source material. They can be MP3, AIFF, 24-bit WAV, or another supported format, but they must not be used directly by app playback. Convert them into the packaged format before wiring them into the app.

## Why 48 kHz

The app uses rodio through cpal for native Rust audio playback. On Linux, the cpal backend currently opens the ALSA `default` device. During investigation, the ALSA default config reported 44.1 kHz while the user's PipeWire/PulseAudio server reported 48 kHz.

Rodio can resample, but its built-in converter is simple and can produce audible artifacts on short, bright notification sounds. The failure mode was especially clear on `break-finished.wav`, `idle-alert.wav`, and the start of `event-notification.wav`: VLC played the files normally, while the app and the app's own media player produced interference-like high-frequency artifacts.

Therefore app sounds are standardized at 48 kHz, and the app-sound output stream requests 48 kHz stereo. This avoids rodio resampling for packaged sounds on the normal desktop audio path.

## Conversion

Use FFmpeg with the `soxr` resampler when converting source sounds into packaged app assets:

```bash
ffmpeg -y -hide_banner -loglevel error -i input.ext -af aresample=resampler=soxr:precision=28:dither_method=triangular_hp -ar 48000 -ac 2 -c:a pcm_s16le apps/client/static/sfx/name.wav
```

The important parts are:

- `aresample=resampler=soxr:precision=28`: high-quality sample-rate conversion.
- `dither_method=triangular_hp`: dithering when reducing bit depth, for example 24-bit source WAV to 16-bit packaged WAV.
- `-ar 48000`: fixed 48 kHz output.
- `-ac 2`: fixed stereo output.
- `-c:a pcm_s16le`: fixed 16-bit PCM WAV payload.

After conversion, verify the files:

```bash
file apps/client/static/sfx/*
```

Expected shape:

```text
RIFF (little-endian) data, WAVE audio, Microsoft PCM, 16 bit, stereo 48000 Hz
```

## Playback architecture

App notification sounds use a dedicated Rust app-sound service, separate from the user media player.

The app-sound service:

- Starts lazily on first app sound.
- Keeps one rodio output stream alive after first use.
- Requests 48 kHz stereo output.
- Queues sounds through one worker so repeated alerts do not spawn unbounded playback threads.
- Drops new sound requests if the queue is full.
- Recreates the output stream after an audio device error.

The app-sound service must stay separate from the local media player. Notification sounds must not affect the user's music or video state, and media player actions such as pause, seek, mute, rate change, or source reload must not affect notification sounds.

Pomodoro terminal completion is the exception because the completion sound is the primary attention cue for the enforced end-of-event screen. If music is already playing, the main window temporarily fades music down, pauses it before the completion sound, waits for the packaged completion sound duration, then resumes music and fades it back to the previous volume. This orchestration must use transient media-player volume changes so the user's saved music volume is not replaced by the temporary ducked value.

## Media player interaction

The local media player also uses rodio. For user-loaded local media, the Rust backend should request the loaded source's own sample rate when opening the output stream. This avoids unnecessary rodio resampling for user audio files.

This does not mean all user media must be 48 kHz. User media keeps its own source format. The 48 kHz rule applies only to packaged app sound assets.

## Maintenance rules

- Do not add packaged app sounds with mixed sample rates.
- Do not rely on rodio's built-in resampler for app sounds.
- Do not use browser notification sounds as a substitute for packaged app sounds.
- Keep sound credits in `README.md` and the Settings About section in sync.
- If a sound sounds correct in VLC but wrong in the app, first check whether rodio is resampling it or opening the output stream at a mismatched rate.
