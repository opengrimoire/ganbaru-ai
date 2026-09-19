use std::{
    fs::File,
    io::BufReader,
    path::Path,
    sync::{Mutex, mpsc},
    thread::{self, JoinHandle},
    time::Duration,
};

use rodio::{
    ChannelCount, Decoder, DeviceSinkBuilder, MixerDeviceSink, Player, SampleRate, Source,
};
use serde::{Deserialize, Serialize};
use tauri::State;

const OUTPUT_SAMPLE_RATE: u32 = 48_000;
const OUTPUT_CHANNELS: u16 = 2;
const RAMP_MILLIS: u64 = 40;
const RAMP_STEPS: u64 = 8;
const NOISE_AMPLITUDE: f32 = 0.22;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum GeneratedNoiseKind {
    White,
    Pink,
    Brown,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SoundscapeStartRequest {
    pub source_id: String,
    pub generated_kind: Option<GeneratedNoiseKind>,
    pub local_path: Option<String>,
    pub volume: f64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum SoundscapeStatus {
    Idle,
    Playing,
    Paused,
    Error,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SoundscapeSnapshot {
    pub status: SoundscapeStatus,
    pub source_id: Option<String>,
    pub volume: f64,
    pub error_code: Option<String>,
}

impl Default for SoundscapeSnapshot {
    fn default() -> Self {
        Self {
            status: SoundscapeStatus::Idle,
            source_id: None,
            volume: 0.35,
            error_code: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SoundscapeError {
    code: String,
    message: String,
}

impl SoundscapeError {
    fn validation(message: impl Into<String>) -> Self {
        Self {
            code: "validation".into(),
            message: message.into(),
        }
    }

    fn audio_device() -> Self {
        Self {
            code: "audio-device".into(),
            message: "The background sound output is unavailable.".into(),
        }
    }

    fn local_file() -> Self {
        Self {
            code: "local-file".into(),
            message: "The selected background audio file is unavailable or unsupported.".into(),
        }
    }

    fn backend() -> Self {
        Self {
            code: "backend".into(),
            message: "The background sound engine is unavailable.".into(),
        }
    }
}

struct NoiseSource {
    kind: GeneratedNoiseKind,
    random_state: u64,
    channel: u16,
    frame: u64,
    current_sample: f32,
    pink_rows: [f32; 7],
    pink_counter: u32,
    brown_value: f32,
    brown_mean: f32,
}

impl NoiseSource {
    fn new(kind: GeneratedNoiseKind, seed: u64) -> Self {
        Self {
            kind,
            random_state: seed.max(1),
            channel: 0,
            frame: 0,
            current_sample: 0.0,
            pink_rows: [0.0; 7],
            pink_counter: 0,
            brown_value: 0.0,
            brown_mean: 0.0,
        }
    }

    fn white(&mut self) -> f32 {
        self.random_state = self
            .random_state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        let unit = (self.random_state >> 40) as f32 / ((1_u32 << 24) - 1) as f32;
        unit.mul_add(2.0, -1.0)
    }

    fn next_mono(&mut self) -> f32 {
        let white = self.white();
        let shaped = match self.kind {
            GeneratedNoiseKind::White => white,
            GeneratedNoiseKind::Pink => {
                self.pink_counter = self.pink_counter.wrapping_add(1);
                let row = self.pink_counter.trailing_zeros().min(6) as usize;
                self.pink_rows[row] = white;
                (self.pink_rows.iter().sum::<f32>() + white) / 8.0
            }
            GeneratedNoiseKind::Brown => {
                self.brown_value = (self.brown_value * 0.995 + white * 0.055).clamp(-1.0, 1.0);
                self.brown_mean = self.brown_mean * 0.9995 + self.brown_value * 0.0005;
                (self.brown_value - self.brown_mean) * 0.8
            }
        };
        let ramp_frames = u64::from(OUTPUT_SAMPLE_RATE) * RAMP_MILLIS / 1_000;
        let ramp = (self.frame as f32 / ramp_frames.max(1) as f32).clamp(0.0, 1.0);
        (shaped * NOISE_AMPLITUDE * ramp).clamp(-NOISE_AMPLITUDE, NOISE_AMPLITUDE)
    }
}

impl Iterator for NoiseSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.channel == 0 {
            self.current_sample = self.next_mono();
        }
        let sample = self.current_sample;
        self.channel += 1;
        if self.channel == OUTPUT_CHANNELS {
            self.channel = 0;
            self.frame = self.frame.saturating_add(1);
        }
        Some(sample)
    }
}

impl Source for NoiseSource {
    fn current_span_len(&self) -> Option<usize> {
        None
    }
    fn channels(&self) -> ChannelCount {
        nonzero_channels(OUTPUT_CHANNELS)
    }
    fn sample_rate(&self) -> SampleRate {
        nonzero_sample_rate(OUTPUT_SAMPLE_RATE)
    }
    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

struct StreamingLoopSource {
    path: String,
    decoder: Decoder<BufReader<File>>,
    channels: ChannelCount,
    sample_rate: SampleRate,
}

impl StreamingLoopSource {
    fn open(path: &str) -> Result<Self, SoundscapeError> {
        let decoder = open_decoder(path)?;
        let channels = decoder.channels();
        let sample_rate = decoder.sample_rate();
        Ok(Self {
            path: path.to_string(),
            decoder,
            channels,
            sample_rate,
        })
    }
}

impl Iterator for StreamingLoopSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if let Some(sample) = self.decoder.next() {
            return Some(sample);
        }
        self.decoder = open_decoder(&self.path).ok()?;
        self.decoder.next()
    }
}

impl Source for StreamingLoopSource {
    fn current_span_len(&self) -> Option<usize> {
        None
    }
    fn channels(&self) -> ChannelCount {
        self.channels
    }
    fn sample_rate(&self) -> SampleRate {
        self.sample_rate
    }
    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

fn open_decoder(path: &str) -> Result<Decoder<BufReader<File>>, SoundscapeError> {
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err(SoundscapeError::local_file());
    }
    let file = File::open(path).map_err(|_| SoundscapeError::local_file())?;
    Decoder::try_from(file).map_err(|_| SoundscapeError::local_file())
}

struct ActiveOutput {
    _sink: MixerDeviceSink,
    player: Player,
    request: SoundscapeStartRequest,
}

impl ActiveOutput {
    fn open(request: SoundscapeStartRequest) -> Result<Self, SoundscapeError> {
        let sample_rate = if let Some(path) = request.local_path.as_deref() {
            StreamingLoopSource::open(path)?.sample_rate()
        } else {
            nonzero_sample_rate(OUTPUT_SAMPLE_RATE)
        };
        let mut sink = DeviceSinkBuilder::from_default_device()
            .map(|builder| builder.with_sample_rate(sample_rate))
            .and_then(|builder| builder.open_sink_or_fallback())
            .map_err(|_| SoundscapeError::audio_device())?;
        sink.log_on_drop(false);
        let player = Player::connect_new(sink.mixer());
        player.set_volume(0.0);
        match (request.generated_kind, request.local_path.as_deref()) {
            (Some(kind), None) => {
                player.append(NoiseSource::new(kind, seed_from_id(&request.source_id)))
            }
            (None, Some(path)) => player.append(StreamingLoopSource::open(path)?),
            _ => {
                return Err(SoundscapeError::validation(
                    "Choose one generated noise or local loop source.",
                ));
            }
        }
        ramp_volume(&player, 0.0, clamp_volume(request.volume));
        Ok(Self {
            _sink: sink,
            player,
            request,
        })
    }

    fn stop(mut self) {
        ramp_volume(&self.player, self.player.volume(), 0.0);
        self.player.stop();
        self.request.volume = f64::from(self.player.volume());
    }
}

#[derive(Default)]
struct EngineCore {
    output: Option<ActiveOutput>,
    last_request: Option<SoundscapeStartRequest>,
    snapshot: SoundscapeSnapshot,
}

impl EngineCore {
    fn handle(&mut self, command: EngineCommand) -> Result<SoundscapeSnapshot, SoundscapeError> {
        match command {
            EngineCommand::Start(request) => self.start(request),
            EngineCommand::Pause => Ok(self.pause()),
            EngineCommand::Resume => self.resume(),
            EngineCommand::Stop => Ok(self.stop()),
            EngineCommand::SetVolume(volume) => self.set_volume(volume),
            EngineCommand::Recover => self.recover(),
            EngineCommand::Snapshot => Ok(self.snapshot.clone()),
        }
    }

    fn start(
        &mut self,
        mut request: SoundscapeStartRequest,
    ) -> Result<SoundscapeSnapshot, SoundscapeError> {
        validate_request(&request)?;
        request.volume = clamp_volume(request.volume);
        self.stop_output();
        match ActiveOutput::open(request.clone()) {
            Ok(output) => {
                self.output = Some(output);
                self.last_request = Some(request.clone());
                self.snapshot = SoundscapeSnapshot {
                    status: SoundscapeStatus::Playing,
                    source_id: Some(request.source_id),
                    volume: request.volume,
                    error_code: None,
                };
                Ok(self.snapshot.clone())
            }
            Err(error) => {
                self.snapshot.status = SoundscapeStatus::Error;
                self.snapshot.source_id = Some(request.source_id);
                self.snapshot.error_code = Some(error.code.clone());
                Err(error)
            }
        }
    }

    fn pause(&mut self) -> SoundscapeSnapshot {
        if let Some(output) = self.output.as_ref() {
            ramp_volume(&output.player, output.player.volume(), 0.0);
            output.player.pause();
            self.snapshot.status = SoundscapeStatus::Paused;
        }
        self.snapshot.clone()
    }

    fn resume(&mut self) -> Result<SoundscapeSnapshot, SoundscapeError> {
        if let Some(output) = self.output.as_ref() {
            output.player.play();
            ramp_volume(&output.player, 0.0, self.snapshot.volume);
            self.snapshot.status = SoundscapeStatus::Playing;
            self.snapshot.error_code = None;
            return Ok(self.snapshot.clone());
        }
        self.recover()
    }

    fn stop(&mut self) -> SoundscapeSnapshot {
        self.stop_output();
        self.last_request = None;
        let volume = self.snapshot.volume;
        self.snapshot = SoundscapeSnapshot {
            volume,
            ..SoundscapeSnapshot::default()
        };
        self.snapshot.clone()
    }

    fn set_volume(&mut self, volume: f64) -> Result<SoundscapeSnapshot, SoundscapeError> {
        if !volume.is_finite() || !(0.0..=1.0).contains(&volume) {
            return Err(SoundscapeError::validation(
                "Volume must be between zero and one.",
            ));
        }
        self.snapshot.volume = volume;
        if let Some(request) = self.last_request.as_mut() {
            request.volume = volume;
        }
        if self.snapshot.status == SoundscapeStatus::Playing {
            if let Some(output) = self.output.as_ref() {
                output.player.set_volume(volume as f32);
            }
        }
        Ok(self.snapshot.clone())
    }

    fn recover(&mut self) -> Result<SoundscapeSnapshot, SoundscapeError> {
        let request = self
            .last_request
            .clone()
            .ok_or_else(SoundscapeError::backend)?;
        self.start(request)
    }

    fn stop_output(&mut self) {
        if let Some(output) = self.output.take() {
            output.stop();
        }
    }
}

enum EngineCommand {
    Start(SoundscapeStartRequest),
    Pause,
    Resume,
    Stop,
    SetVolume(f64),
    Recover,
    Snapshot,
}

enum EngineMessage {
    Command(
        EngineCommand,
        mpsc::Sender<Result<SoundscapeSnapshot, SoundscapeError>>,
    ),
    Shutdown,
}

struct EngineController {
    sender: mpsc::Sender<EngineMessage>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl EngineController {
    fn new() -> Self {
        let (sender, receiver) = mpsc::channel();
        let worker = thread::Builder::new()
            .name("ganbaru-ai-soundscape".into())
            .spawn(move || {
                let mut core = EngineCore::default();
                while let Ok(message) = receiver.recv() {
                    match message {
                        EngineMessage::Command(command, reply) => {
                            let _ = reply.send(core.handle(command));
                        }
                        EngineMessage::Shutdown => {
                            core.stop_output();
                            break;
                        }
                    }
                }
            })
            .expect("failed to start soundscape worker");
        Self {
            sender,
            worker: Mutex::new(Some(worker)),
        }
    }

    fn dispatch(&self, command: EngineCommand) -> Result<SoundscapeSnapshot, SoundscapeError> {
        let (reply, receiver) = mpsc::channel();
        self.sender
            .send(EngineMessage::Command(command, reply))
            .map_err(|_| SoundscapeError::backend())?;
        receiver.recv().map_err(|_| SoundscapeError::backend())?
    }
}

impl Default for EngineController {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for EngineController {
    fn drop(&mut self) {
        let _ = self.sender.send(EngineMessage::Shutdown);
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(worker) = worker.take() {
                let _ = worker.join();
            }
        }
    }
}

#[derive(Default)]
pub(crate) struct SoundscapeEngineState {
    controller: EngineController,
}

#[tauri::command]
pub(crate) fn soundscape_start(
    state: State<'_, SoundscapeEngineState>,
    request: SoundscapeStartRequest,
) -> Result<SoundscapeSnapshot, SoundscapeError> {
    state.controller.dispatch(EngineCommand::Start(request))
}

#[tauri::command]
pub(crate) fn soundscape_pause(
    state: State<'_, SoundscapeEngineState>,
) -> Result<SoundscapeSnapshot, SoundscapeError> {
    state.controller.dispatch(EngineCommand::Pause)
}

#[tauri::command]
pub(crate) fn soundscape_resume(
    state: State<'_, SoundscapeEngineState>,
) -> Result<SoundscapeSnapshot, SoundscapeError> {
    state.controller.dispatch(EngineCommand::Resume)
}

#[tauri::command]
pub(crate) fn soundscape_stop(
    state: State<'_, SoundscapeEngineState>,
) -> Result<SoundscapeSnapshot, SoundscapeError> {
    state.controller.dispatch(EngineCommand::Stop)
}

#[tauri::command]
pub(crate) fn soundscape_set_volume(
    state: State<'_, SoundscapeEngineState>,
    volume: f64,
) -> Result<SoundscapeSnapshot, SoundscapeError> {
    state.controller.dispatch(EngineCommand::SetVolume(volume))
}

#[tauri::command]
pub(crate) fn soundscape_recover(
    state: State<'_, SoundscapeEngineState>,
) -> Result<SoundscapeSnapshot, SoundscapeError> {
    state.controller.dispatch(EngineCommand::Recover)
}

#[tauri::command]
pub(crate) fn soundscape_snapshot(
    state: State<'_, SoundscapeEngineState>,
) -> Result<SoundscapeSnapshot, SoundscapeError> {
    state.controller.dispatch(EngineCommand::Snapshot)
}

fn validate_request(request: &SoundscapeStartRequest) -> Result<(), SoundscapeError> {
    if request.source_id.trim().is_empty() {
        return Err(SoundscapeError::validation(
            "A stable source id is required.",
        ));
    }
    if !request.volume.is_finite() || !(0.0..=1.0).contains(&request.volume) {
        return Err(SoundscapeError::validation(
            "Volume must be between zero and one.",
        ));
    }
    match (request.generated_kind, request.local_path.as_deref()) {
        (Some(_), None) => Ok(()),
        (None, Some(path)) if Path::new(path).is_absolute() => Ok(()),
        _ => Err(SoundscapeError::validation(
            "Choose one generated noise or local loop source.",
        )),
    }
}

fn clamp_volume(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        0.35
    }
}

fn ramp_volume(player: &Player, from: f32, to: f64) {
    for volume in ramp_values(from, to as f32) {
        player.set_volume(volume);
        thread::sleep(Duration::from_millis(RAMP_MILLIS / RAMP_STEPS));
    }
}

fn ramp_values(from: f32, to: f32) -> impl Iterator<Item = f32> {
    (1..=RAMP_STEPS).map(move |step| {
        let progress = step as f32 / RAMP_STEPS as f32;
        from + (to - from) * progress
    })
}

fn seed_from_id(value: &str) -> u64 {
    value.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100_0000_01b3)
    })
}

fn nonzero_sample_rate(value: u32) -> SampleRate {
    SampleRate::new(value).expect("sample rate must be greater than zero")
}

fn nonzero_channels(value: u16) -> ChannelCount {
    ChannelCount::new(value).expect("channel count must be greater than zero")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mono_samples(kind: GeneratedNoiseKind, count: usize) -> Vec<f32> {
        NoiseSource::new(kind, 42)
            .step_by(2)
            .skip(2_000)
            .take(count)
            .collect()
    }

    fn roughness(samples: &[f32]) -> f32 {
        samples
            .windows(2)
            .map(|pair| (pair[1] - pair[0]).abs())
            .sum::<f32>()
            / (samples.len() - 1) as f32
    }

    #[test]
    fn generated_noise_is_deterministic_bounded_and_ramped() {
        let first: Vec<_> = NoiseSource::new(GeneratedNoiseKind::White, 7)
            .take(2_000)
            .collect();
        let second: Vec<_> = NoiseSource::new(GeneratedNoiseKind::White, 7)
            .take(2_000)
            .collect();
        assert_eq!(first, second);
        assert!(first.iter().all(|sample| sample.abs() <= NOISE_AMPLITUDE));
        assert!(first[0].abs() < 0.001);
        assert!(first[1_900].abs() > first[0].abs());
    }

    #[test]
    fn generated_noise_spectra_have_distinct_roughness() {
        let white = roughness(&mono_samples(GeneratedNoiseKind::White, 20_000));
        let pink = roughness(&mono_samples(GeneratedNoiseKind::Pink, 20_000));
        let brown = roughness(&mono_samples(GeneratedNoiseKind::Brown, 20_000));
        assert!(white > pink * 1.5, "white={white}, pink={pink}");
        assert!(pink > brown * 1.5, "pink={pink}, brown={brown}");
    }

    #[test]
    fn generated_noise_stays_near_zero_mean() {
        for kind in [
            GeneratedNoiseKind::White,
            GeneratedNoiseKind::Pink,
            GeneratedNoiseKind::Brown,
        ] {
            let samples = mono_samples(kind, 100_000);
            let mean = samples.iter().sum::<f32>() / samples.len() as f32;
            assert!(mean.abs() < 0.02, "{kind:?} mean={mean}");
        }
    }

    #[test]
    fn source_request_requires_exactly_one_source() {
        let request = SoundscapeStartRequest {
            source_id: "rain".into(),
            generated_kind: Some(GeneratedNoiseKind::White),
            local_path: Some("/tmp/rain.wav".into()),
            volume: 0.4,
        };
        assert!(validate_request(&request).is_err());
    }

    #[test]
    fn volume_ramps_end_at_target_without_an_abrupt_step() {
        let down = ramp_values(0.8, 0.0).collect::<Vec<_>>();
        assert_eq!(down.last().copied(), Some(0.0));
        assert!(down.windows(2).all(|pair| pair[1] <= pair[0]));
        assert!(
            down.windows(2)
                .all(|pair| (pair[1] - pair[0]).abs() <= 0.11)
        );
        let up = ramp_values(0.0, 0.8).collect::<Vec<_>>();
        assert_eq!(up.last().copied(), Some(0.8));
        assert!(up.windows(2).all(|pair| pair[1] >= pair[0]));
    }
}
