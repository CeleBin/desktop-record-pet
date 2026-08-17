//! Global-hotkey microphone recording: capture default mic with cpal,
//! export PCM16 WAV via hound, notify the pet window via events.

use std::io::Cursor;
use std::path::Path;
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::errors::{AppError, AppResult};
use crate::windows::PET_LABEL;

/// `cpal::Stream` is `!Send` on Windows (WASAPI); all access is guarded by a
/// `Mutex` and cpal guarantees a `Stream` may be dropped on any thread, so
/// forwarding `Send` is sound.
struct AudioStream(Option<cpal::Stream>);

unsafe impl Send for AudioStream {}

/// Payload emitted on the pet window whenever recording state changes.
#[derive(Clone, Serialize)]
pub struct RecordingStatusPayload {
    pub recording: bool,
    pub path: Option<String>,
    pub error: Option<String>,
}

/// Shared recording state managed by Tauri.
pub struct RecordingState {
    active: Mutex<bool>,
    samples: Arc<Mutex<Vec<f32>>>,
    sample_rate: Mutex<u32>,
    channels: Mutex<u16>,
    stream: Mutex<AudioStream>,
}

impl Default for RecordingState {
    fn default() -> Self {
        Self {
            active: Mutex::new(false),
            samples: Arc::new(Mutex::new(Vec::new())),
            sample_rate: Mutex::new(0),
            channels: Mutex::new(0),
            stream: Mutex::new(AudioStream(None)),
        }
    }
}

fn emit_status(app: &AppHandle, payload: RecordingStatusPayload) {
    let _ = app.emit_to(PET_LABEL, "recording:status", payload);
}

/// Toggle microphone recording. Returns `Ok(Some(path))` when a recording
/// was just stopped and saved, `Ok(None)` when it just started.
pub fn toggle_recording(app: &AppHandle, data_dir: &Path) -> AppResult<Option<String>> {
    let state = app.state::<RecordingState>();
    let active = *state.active.lock().map_err(AppError::from)?;
    if active {
        stop_recording(app, &state, data_dir)
    } else {
        start_recording(app, &state)
    }
}

fn start_recording(app: &AppHandle, state: &RecordingState) -> AppResult<Option<String>> {
    let host = cpal::default_host();
    let device = host.default_input_device().ok_or_else(|| {
        AppError::Validation("未找到麦克风".into())
    })?;
    let config = device.default_input_config().map_err(|error| {
        AppError::Validation(format!("无法获取麦克风默认配置: {error}"))
    })?;

    let sample_rate = config.sample_rate().0;
    let channels = config.channels();

    {
        let mut samples = state.samples.lock().map_err(AppError::from)?;
        samples.clear();
        *state.sample_rate.lock().map_err(AppError::from)? = sample_rate;
        *state.channels.lock().map_err(AppError::from)? = channels;
    }

    let samples_arc = Arc::clone(&state.samples);
    let error_callback = |error| eprintln!("recording stream error: {error}");

    let sample_format = config.sample_format();
    let stream_config = config.into();
    let stream = match sample_format {
        cpal::SampleFormat::F32 => {
            build_input_stream::<f32>(&device, &stream_config, samples_arc, error_callback)
        }
        cpal::SampleFormat::I16 => {
            build_input_stream::<i16>(&device, &stream_config, samples_arc, error_callback)
        }
        cpal::SampleFormat::U16 => {
            build_input_stream::<u16>(&device, &stream_config, samples_arc, error_callback)
        }
        other => {
            return Err(AppError::Validation(format!(
                "不支持的采样格式: {other:?}"
            )))
        }
    }
    .map_err(|error| AppError::Io(format!("无法启动录音: {error}")))?;

    stream
        .play()
        .map_err(|error| AppError::Io(format!("无法开始录音: {error}")))?;

    *state.stream.lock().map_err(AppError::from)? = AudioStream(Some(stream));
    *state.active.lock().map_err(AppError::from)? = true;

    emit_status(
        app,
        RecordingStatusPayload {
            recording: true,
            path: None,
            error: None,
        },
    );
    Ok(None)
}

fn build_input_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    samples: Arc<Mutex<Vec<f32>>>,
    error_callback: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<cpal::Stream, cpal::BuildStreamError>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    device.build_input_stream(
        config,
        move |data: &[T], _: &cpal::InputCallbackInfo| {
            if let Ok(mut guard) = samples.lock() {
                for sample in data {
                    guard.push(sample.to_sample::<f32>());
                }
            }
        },
        error_callback,
        None,
    )
}

fn stop_recording(
    app: &AppHandle,
    state: &RecordingState,
    data_dir: &Path,
) -> AppResult<Option<String>> {
    if let Ok(mut stream_guard) = state.stream.lock() {
        if let Some(stream) = stream_guard.0.take() {
            drop(stream);
        }
    }

    let (samples, sample_rate, channels) = {
        let samples = std::mem::take(&mut *state.samples.lock().map_err(AppError::from)?);
        let sample_rate = *state.sample_rate.lock().map_err(AppError::from)?;
        let channels = *state.channels.lock().map_err(AppError::from)?;
        (samples, sample_rate, channels)
    };

    *state.active.lock().map_err(AppError::from)? = false;

    if samples.is_empty() {
        emit_status(
            app,
            RecordingStatusPayload {
                recording: false,
                path: None,
                error: Some("没有采集到音频，未保存".into()),
            },
        );
        return Ok(None);
    }

    let recordings_dir = data_dir.join("recordings");
    std::fs::create_dir_all(&recordings_dir)?;
    let file_name = format!(
        "recording-{}.wav",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    let file_path = recordings_dir.join(&file_name);

    let bytes = encode_wav_bytes(&samples, sample_rate, channels);
    std::fs::write(&file_path, bytes)?;

    let path_str = file_path.to_string_lossy().into_owned();
    emit_status(
        app,
        RecordingStatusPayload {
            recording: false,
            path: Some(path_str.clone()),
            error: None,
        },
    );
    Ok(Some(path_str))
}

/// Encode f32 samples as a 16-bit PCM WAV byte buffer.
pub fn encode_wav_bytes(samples: &[f32], sample_rate: u32, channels: u16) -> Vec<u8> {
    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec)
            .expect("writing WAV into an in-memory cursor cannot fail");
        for sample in samples {
            let clamped = sample.clamp(-1.0, 1.0);
            writer
                .write_sample((clamped * i16::MAX as f32) as i16)
                .expect("writing a sample into a cursor cannot fail");
        }
        writer.finalize().expect("finalizing an in-memory WAV cannot fail");
    }
    cursor.into_inner()
}

#[cfg(test)]
mod tests {
    use std::io::Read;

    use super::*;

    #[test]
    fn wav_header_matches_spec() {
        let bytes = encode_wav_bytes(&[0.0, 0.5, -0.5], 44_100, 1);
        let mut reader = hound::WavReader::new(bytes.as_slice()).expect("valid wav");
        let spec = reader.spec();
        assert_eq!(spec.sample_rate, 44_100);
        assert_eq!(spec.channels, 1);
        assert_eq!(spec.bits_per_sample, 16);
        assert_eq!(spec.sample_format, hound::SampleFormat::Int);
        assert_eq!(reader.len(), 3);
    }

    #[test]
    fn wav_samples_round_trip() {
        let bytes = encode_wav_bytes(&[0.0, 0.5, -0.5, 1.0, -1.0], 8_000, 1);
        let mut reader = hound::WavReader::new(bytes.as_slice()).expect("valid wav");
        let samples: Vec<i16> = reader.samples::<i16>().map(|s| s.expect("sample")).collect();
        assert_eq!(samples.len(), 5);
        assert_eq!(samples[0], 0);
        assert!(samples[1] > 0);
        assert!(samples[2] < 0);
        assert!(samples[3] > 0);
        assert!(samples[4] < 0);
    }

    #[test]
    fn wav_handle_is_complete() {
        let bytes = encode_wav_bytes(&[0.0; 100], 44_100, 2);
        let mut reader = hound::WavReader::new(bytes.as_slice()).expect("valid wav");
        assert_eq!(reader.len(), 100);
        // 100 samples x 2 bytes each = 200 data bytes + 44 byte header.
        assert_eq!(bytes.len(), 44 + 100 * 2);
    }
}
