#![allow(dead_code)]

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::{Path, PathBuf};

use uuid::Uuid;

use crate::errors::{AppError, AppResult};

/// Capture a screen region on the primary monitor.
pub fn capture_region(
    logical_x: u32,
    logical_y: u32,
    logical_w: u32,
    logical_h: u32,
    attachments_dir: &Path,
) -> AppResult<PathBuf> {
    let monitors =
        xcap::Monitor::all().map_err(|e| AppError::State(format!("xcap monitors: {e}")))?;
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .ok_or_else(|| AppError::NotFound("primary monitor".into()))?;

    let scale = monitor
        .scale_factor()
        .map_err(|e| AppError::State(format!("scale_factor: {e}")))?;

    // Logical -> physical pixel conversion
    let phys_x = (logical_x as f32 * scale) as u32;
    let phys_y = (logical_y as f32 * scale) as u32;
    let phys_w = ((logical_w as f32 * scale).max(1.0)) as u32;
    let phys_h = ((logical_h as f32 * scale).max(1.0)) as u32;

    let mon_w = monitor
        .width()
        .map_err(|e| AppError::State(format!("monitor width: {e}")))?;
    let mon_h = monitor
        .height()
        .map_err(|e| AppError::State(format!("monitor height: {e}")))?;

    // Clamp to monitor bounds
    let phys_x = phys_x.min(mon_w.saturating_sub(1));
    let phys_y = phys_y.min(mon_h.saturating_sub(1));
    let phys_w = phys_w.min(mon_w.saturating_sub(phys_x)).max(1);
    let phys_h = phys_h.min(mon_h.saturating_sub(phys_y)).max(1);

    let img = monitor
        .capture_region(phys_x, phys_y, phys_w, phys_h)
        .map_err(|e| AppError::State(format!("xcap capture_region: {e}")))?;

    fs::create_dir_all(attachments_dir)?;
    let filename = format!("{}.png", Uuid::new_v4());
    let filepath = attachments_dir.join(&filename);
    img.save(&filepath)
        .map_err(|e| AppError::Io(format!("save screenshot: {e}")))?;

    Ok(filepath)
}

/// Compute a non-cryptographic hash of file contents for dedup.
pub fn compute_file_hash(path: &Path) -> AppResult<String> {
    let mut file = fs::File::open(path)?;
    let mut contents = Vec::new();
    file.read_to_end(&mut contents)?;
    let mut hasher = DefaultHasher::new();
    contents.hash(&mut hasher);
    Ok(format!("{:016x}", hasher.finish()))
}