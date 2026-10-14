//! Files used by the note editor. Commands live at the Tauri boundary.
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Serialize;
use std::{fs, path::{Path, PathBuf}, time::{Duration, SystemTime, UNIX_EPOCH}};
use std::sync::atomic::{AtomicU64, Ordering};

fn root() -> Result<PathBuf, String> {
    linows_backend::look_engine::config_path::home()
        .map(|home| PathBuf::from(home).join(".look"))
        .ok_or_else(|| "Could not locate the home directory".into())
}

fn unique_id() -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    format!("{}-{}-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos(),
        std::process::id(), SEQ.fetch_add(1, Ordering::Relaxed))
}

fn save_image(dir: &Path, data: &str, ext: &str) -> Result<String, String> {
    let ext = ext.to_ascii_lowercase();
    let ext = match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "avif" | "ico" | "tiff" => ext,
        "svg+xml" => "svg".into(),
        _ => return Err("Unsupported image format".into()),
    };
    const MAX_BYTES: usize = 32 * 1024 * 1024;
    if data.len() > MAX_BYTES.div_ceil(3) * 4 { return Err("Image exceeds 32 MB".into()); }
    let bytes = STANDARD.decode(data).map_err(|_| "Invalid image data".to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_BYTES { return Err("Image is empty or exceeds 32 MB".into()); }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("img-{}.{}", unique_id(), ext));
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
pub fn notes_save_image(data: String, ext: String) -> Result<String, String> {
    save_image(&root()?.join("note-images"), &data, &ext)
}

fn prune_images(dir: &Path, bodies: &[String], now: SystemTime) -> Result<usize, String> {
    if !dir.exists() { return Ok(0); }
    let mut removed = 0;
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("img-") || !entry.file_type().map_err(|e| e.to_string())?.is_file()
            || bodies.iter().any(|body| body.contains(&name)) { continue; }
        let modified = entry.metadata().and_then(|m| m.modified()).map_err(|e| e.to_string())?;
        if now.duration_since(modified).unwrap_or_default() < Duration::from_secs(3600) { continue; }
        fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
        removed += 1;
    }
    Ok(removed)
}

#[tauri::command]
pub fn notes_prune_images() -> Result<usize, String> {
    // Read the store successfully before considering any deletion.
    let notes = super::notes::notes_list()?;
    let bodies = notes.into_iter().map(|note| note.body).collect::<Vec<_>>();
    prune_images(&root()?.join("note-images"), &bodies, SystemTime::now())
}

fn named_path(dir: &Path, name: &str, ext: &str) -> Result<PathBuf, String> {
    let name = name.trim();
    let reserved = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if name.is_empty() || name.chars().count() > 60 || name.ends_with('.')
        || name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        || name == "." || name == ".." || ["CON", "PRN", "AUX", "NUL"].contains(&reserved.as_str())
        || (reserved.len() == 4 && (reserved.starts_with("COM") || reserved.starts_with("LPT"))
            && reserved.as_bytes()[3].is_ascii_digit()) {
        return Err("Choose a valid file name (up to 60 characters)".into());
    }
    Ok(dir.join(format!("{name}.{ext}")))
}

fn list_files(dir: &Path, ext: &str) -> Result<Vec<(String, String)>, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some(ext) {
            let name = path.file_stem().unwrap().to_string_lossy().into_owned();
            files.push((name, fs::read_to_string(path).map_err(|e| e.to_string())?));
        }
    }
    files.sort_by_key(|(name, _)| name.to_lowercase());
    Ok(files)
}

fn save_named(dir: &Path, name: &str, data: &str, old_name: Option<&str>, ext: &str) -> Result<String, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = named_path(dir, name, ext)?;
    let old = old_name.map(|n| named_path(dir, n, ext)).transpose()?;
    let same = old.as_ref().is_some_and(|p| p == &path || (p.exists() && path.exists()
        && fs::canonicalize(p).ok() == fs::canonicalize(&path).ok()));
    if path.exists() && !same { return Err("That name is already taken".into()); }
    // Stage the new content before replacing the existing file.
    let staged = dir.join(format!(".{}.tmp", unique_id()));
    fs::write(&staged, data).map_err(|e| e.to_string())?;
    let result = fs::copy(&staged, &path).map_err(|e| e.to_string());
    let _ = fs::remove_file(staged);
    result?;
    if let Some(old) = old.filter(|p| p != &path && !same && p.exists()) {
        fs::remove_file(old).map_err(|e| e.to_string())?;
    }
    Ok(name.trim().into())
}

fn delete_named(dir: &Path, name: &str, ext: &str) -> Result<(), String> {
    let path = named_path(dir, name, ext)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Serialize)]
pub struct Template { name: String, body: String }

#[tauri::command]
pub fn notes_templates_list() -> Result<Vec<Template>, String> {
    let dir = root()?.join("note-templates");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        save_named(&dir, "Blank", "{{cursor}}", None, "md")?;
        save_named(&dir, "Daily note", "# {{date}}\n\n{{cursor}}", None, "md")?;
        save_named(&dir, "Meeting", "# {{title}}\n\n{{datetime}}\n\n## Notes\n\n{{cursor}}\n\n## Actions\n\n- [ ] ", None, "md")?;
    }
    Ok(list_files(&dir, "md")?.into_iter().map(|(name, body)| Template { name, body }).collect())
}

#[tauri::command]
pub fn notes_template_save(name: String, body: String, old_name: Option<String>) -> Result<String, String> {
    save_named(&root()?.join("note-templates"), &name, &body, old_name.as_deref(), "md")
}

#[tauri::command]
pub fn notes_template_delete(name: String) -> Result<(), String> {
    delete_named(&root()?.join("note-templates"), &name, "md")
}

fn theme_dir(kind: &str) -> Result<PathBuf, String> {
    if !["look", "note"].contains(&kind) { return Err("Unknown theme kind".into()); }
    Ok(root()?.join("themes").join(kind))
}

#[derive(Serialize)]
pub struct Theme { name: String, data: String }

#[tauri::command]
pub fn themes_list(kind: String) -> Result<Vec<Theme>, String> {
    Ok(list_files(&theme_dir(&kind)?, "json")?.into_iter().map(|(name, data)| Theme { name, data }).collect())
}

#[tauri::command]
pub fn theme_save(kind: String, name: String, data: String, old_name: Option<String>) -> Result<String, String> {
    serde_json::from_str::<serde_json::Value>(&data).map_err(|e| e.to_string())?;
    save_named(&theme_dir(&kind)?, &name, &data, old_name.as_deref(), "json")
}

#[tauri::command]
pub fn theme_delete(kind: String, name: String) -> Result<(), String> {
    delete_named(&theme_dir(&kind)?, &name, "json")
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("look-note-assets-{}", unique_id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }

    #[test]
    fn pasted_image_survives_note_save_and_reload_and_cleanup() {
        let temp = Temp::new();
        let images = temp.0.join("note-images");
        let data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
        let path = save_image(&images, data, "png").unwrap();
        assert_eq!(fs::read(&path).unwrap(), STANDARD.decode(data).unwrap());
        let store = look_notes::NoteStore::open(temp.0.join("notes.db")).unwrap();
        let note = look_notes::Note {
            id: "image-note".into(), title: "Picture".into(), body: format!("![]({path})\n"),
            tags: vec![], created_at_unix_s: 0, updated_at_unix_s: 0,
        };
        store.save(&note, 1).unwrap();
        drop(store);
        let store = look_notes::NoteStore::open(temp.0.join("notes.db")).unwrap();
        let loaded = store.list().unwrap();
        assert_eq!(loaded[0].body, note.body);
        let bodies = loaded.into_iter().map(|n| n.body).collect::<Vec<_>>();
        let orphan = save_image(&images, data, "png").unwrap();
        assert_ne!(path, orphan);
        let unmanaged = images.join("user-picture.png");
        fs::write(&unmanaged, "keep").unwrap();
        assert_eq!(prune_images(&images, &bodies, SystemTime::now()).unwrap(), 0);
        assert_eq!(prune_images(&images, &bodies, SystemTime::now() + Duration::from_secs(3601)).unwrap(), 1);
        assert!(Path::new(&path).is_file());
        assert!(!Path::new(&orphan).exists());
        assert!(unmanaged.is_file());
    }

    #[test]
    fn invalid_image_inputs_write_nothing() {
        let temp = Temp::new();
        let images = temp.0.join("images");
        for (data, ext) in [("aGVsbG8=", "../png"), ("not base64!", "png"), ("", "png")] {
            assert!(save_image(&images, data, ext).is_err());
        }
        assert!(!images.exists());
    }

    #[test]
    fn templates_and_themes_round_trip_edit_rename_and_delete() {
        let temp = Temp::new();
        for ext in ["md", "json"] {
            let dir = temp.0.join(ext);
            assert_eq!(save_named(&dir, "Plan", "first", None, ext).unwrap(), "Plan");
            assert!(save_named(&dir, "Plan", "collision", None, ext).is_err());
            save_named(&dir, "Plan", "edited", Some("Plan"), ext).unwrap();
            save_named(&dir, "New plan", "renamed", Some("Plan"), ext).unwrap();
            assert_eq!(list_files(&dir, ext).unwrap(), vec![("New plan".into(), "renamed".into())]);
            for name in ["../escape", "a/b", "a\\b", "..", "CON", "end."] {
                assert!(save_named(&dir, name, "bad", None, ext).is_err());
            }
            delete_named(&dir, "New plan", ext).unwrap();
            assert!(list_files(&dir, ext).unwrap().is_empty());
        }
        assert!(theme_dir("../escape").is_err());
    }
}
