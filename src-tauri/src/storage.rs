use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

const MAX_FILE_BYTES: u64 = 24_000_000;
const MAX_FILENAME_BYTES: usize = 160;
const WORKSPACE_FILE: &str = "workspace.json";
const RECYCLED_DIR: &str = "recycled";
pub const MAX_NOTES: usize = 100;

/// 扫描结果：正文完全以 .txt 文件为事实来源（数据目录 = 笔记，recycled/ = 废纸篓），
/// workspace.json 只保存主题、当前笔记与格式设置。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Payload {
    version: u8,
    notes: Vec<PayloadNote>,
    active_id: Option<String>,
    theme: String,
    #[serde(default)]
    format: FormatSettings,
}

/// 单篇笔记：id 即文件相对路径（`预算.txt` 或 `recycled/预算.txt`）。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PayloadNote {
    id: String,
    #[serde(default)]
    filename: String,
    title: String,
    #[serde(default)]
    body: String,
    created_at: String,
    updated_at: String,
    trashed: bool,
}

/// 落盘的工作区设置（主题、当前笔记、格式），不含笔记清单。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSettings {
    version: u8,
    active_id: Option<String>,
    theme: String,
    #[serde(default)]
    format: FormatSettings,
}

// 兼容读取改造前的格式：正文内联在 workspace.json、笔记清单驱动。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredNote {
    id: String,
    title: String,
    #[serde(default)]
    filename: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    trashed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    version: u8,
    #[serde(default)]
    notes: Vec<StoredNote>,
    #[serde(default)]
    active_id: Option<String>,
    theme: String,
    #[serde(default)]
    format: Option<FormatSettings>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FormatSettings {
    #[serde(default)]
    thousands: bool,
    #[serde(default)]
    unit_space: bool,
    #[serde(default)]
    percent_space: bool,
    #[serde(default = "default_true")]
    operator_space: bool,
    #[serde(default = "default_true")]
    comment_space: bool,
    #[serde(default)]
    unit_style: String,
    #[serde(default)]
    unit_system: String,
}

impl Default for FormatSettings {
    fn default() -> Self {
        FormatSettings {
            thousands: false,
            unit_space: false,
            percent_space: false,
            operator_space: true,
            comment_space: true,
            unit_style: "free".into(),
            unit_system: "free".into(),
        }
    }
}

fn default_true() -> bool {
    true
}

impl FormatSettings {
    fn validate(&self) -> Result<(), String> {
        if !matches!(
            self.unit_style.as_str(),
            "free" | "chinese" | "upper" | "lower"
        ) {
            return Err("单位风格配置无效".into());
        }
        if !matches!(
            self.unit_system.as_str(),
            "free" | "metric" | "imperial" | "market"
        ) {
            return Err("单位制配置无效".into());
        }
        Ok(())
    }
}

fn valid_theme(theme: &str) -> bool {
    matches!(
        theme,
        "light" | "dark" | "paper" | "sand" | "mist" | "forest" | "midnight" | "graphite"
    )
}

fn truncate_bytes(text: &str, limit: usize) -> String {
    let mut result = String::new();
    for character in text.chars() {
        if result.len() + character.len_utf8() > limit {
            break;
        }
        result.push(character);
    }
    result
}

/// 用标题生成文件名；标题里不能进文件名的字符换成 `-`，为空时退回给定的兜底名。
pub fn slugify(title: &str, fallback: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|character| {
            if character.is_control() || "/\\:*?\"<>|".contains(character) {
                '-'
            } else {
                character
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches(['.', ' ']).to_string();
    let stem = if trimmed.is_empty() {
        truncate_bytes(fallback, 60)
    } else {
        truncate_bytes(&trimmed, MAX_FILENAME_BYTES - 4)
    };
    format!("{stem}.txt")
}

fn unique_name(name: String, used: &HashSet<String>) -> String {
    if !used.contains(&name) {
        return name;
    }
    let stem = name.strip_suffix(".txt").unwrap_or(&name);
    let stem = truncate_bytes(stem, MAX_FILENAME_BYTES - 8);
    for index in 2..1000 {
        let candidate = format!("{stem} {index}.txt");
        if !used.contains(&candidate) {
            return candidate;
        }
    }
    format!("{}-{}.txt", stem, used.len())
}

/// 文件名只能是不含路径的普通名称，防止读写被带出数据目录。
fn validate_filename(name: &str) -> Result<(), String> {
    let path = Path::new(name);
    if name.is_empty()
        || name.len() > MAX_FILENAME_BYTES
        || name.starts_with('.')
        || !name.ends_with(".txt")
        || path.components().count() != 1
        || path.file_name().is_none_or(|file| file != name)
    {
        return Err("笔记文件名无效".into());
    }
    Ok(())
}

/// 笔记 id（文件相对路径）→ 数据目录内的实际路径；recycled/ 前缀即废纸篓。
/// id 来自前端，这里做路径安全校验。
pub fn resolve_note_path(directory: &Path, note_id: &str) -> Result<(PathBuf, bool), String> {
    const PREFIX: &str = "recycled/";
    let (name, trashed) = if let Some(rest) = note_id.strip_prefix(PREFIX) {
        (rest, true)
    } else {
        (note_id, false)
    };
    validate_filename(name)?;
    let path = if trashed {
        directory.join(RECYCLED_DIR).join(name)
    } else {
        directory.join(name)
    };
    Ok((path, trashed))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut temporary = path.as_os_str().to_os_string();
    temporary.push(".tmp");
    let temporary = PathBuf::from(temporary);
    let mut file =
        fs::File::create(&temporary).map_err(|error| format!("无法暂存文件：{error}"))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|error| format!("写入失败：{error}"))?;
    drop(file);
    fs::rename(&temporary, path).map_err(|error| format!("替换文件失败：{error}"))
}

/// Unix 秒 → ISO 8601（UTC）。避免为此引入日期库。
fn iso_timestamp(secs: i64) -> String {
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let (hour, minute, second) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Howard Hinnant civil_from_days：天数 → 年月日
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.000Z")
}

fn file_timestamps(path: &Path) -> (String, String) {
    let metadata = fs::metadata(path).ok();
    let secs = |time: Option<std::time::SystemTime>| -> i64 {
        time.and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or(0)
    };
    let modified = secs(metadata.as_ref().and_then(|meta| meta.modified().ok()));
    let created = secs(metadata.as_ref().and_then(|meta| meta.created().ok()));
    (iso_timestamp(created), iso_timestamp(modified))
}

/// 从正文取标题：首个非空行若是 `# 标题` 则用之，否则用文件名主干。
fn derive_title(body: &str, stem: &str) -> String {
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix('#') {
            let title = rest.trim();
            if !title.is_empty() {
                return truncate_bytes(title, 120);
            }
        }
        break;
    }
    truncate_bytes(stem, 120)
}

fn read_text_file(path: &Path) -> Result<String, String> {
    let name = path
        .file_name()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_default();
    let metadata = fs::metadata(path)
        .map_err(|error| format!("无法读取笔记 {name}：{error}。原文件未改动"))?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(format!(
            "笔记 {name} 超过 24 MB，请把该文件移出笔记文件夹后重试"
        ));
    }
    let bytes =
        fs::read(path).map_err(|error| format!("无法读取笔记 {name}：{error}。原文件未改动"))?;
    String::from_utf8(bytes).map_err(|_| format!("笔记 {name} 不是 UTF-8 文本，原文件未改动"))
}

/// 扫描一个目录层（正常笔记或废纸篓），按更新时间从新到旧排序。
fn scan_layer(
    directory: &Path,
    sub: Option<&str>,
    trashed: bool,
) -> Result<Vec<PayloadNote>, String> {
    let base = match sub {
        Some(sub) => directory.join(sub),
        None => directory.to_path_buf(),
    };
    let mut entries: Vec<(PathBuf, String, std::time::SystemTime)> = Vec::new();
    for entry in fs::read_dir(&base).map_err(|error| format!("无法读取笔记目录：{error}"))?
    {
        let entry = entry.map_err(|error| format!("无法读取笔记目录：{error}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".txt") || name.starts_with('.') || name.ends_with(".tmp") {
            continue;
        }
        if validate_filename(&name).is_err() {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        entries.push((
            path,
            name,
            std::time::UNIX_EPOCH + std::time::Duration::from_secs(modified),
        ));
    }
    // 最近更新的先出现在列表里
    entries.sort_by_key(|(_, _, modified)| std::cmp::Reverse(*modified));
    let mut notes = Vec::new();
    for (path, name, _) in entries {
        let body = read_text_file(&path)?;
        let (created_at, updated_at) = file_timestamps(&path);
        let stem = name.strip_suffix(".txt").unwrap_or(&name).to_string();
        let id = match sub {
            Some(sub) => format!("{sub}/{name}"),
            None => name.clone(),
        };
        notes.push(PayloadNote {
            id,
            filename: String::new(),
            title: derive_title(&body, &stem),
            body,
            created_at,
            updated_at,
            trashed,
        });
    }
    Ok(notes)
}

/// 启动扫描：数据目录与 recycled/ 下的全部 .txt 都是笔记。
/// 外部新增/删除的文件在扫描时自动同步。
pub fn scan(directory: &Path) -> Result<Payload, String> {
    fs::create_dir_all(directory).map_err(|error| format!("无法创建笔记目录：{error}"))?;
    fs::create_dir_all(directory.join(RECYCLED_DIR))
        .map_err(|error| format!("无法创建废纸篓目录：{error}"))?;
    let settings = read_workspace_settings(directory)?;
    let mut notes = scan_layer(directory, None, false)?;
    notes.extend(scan_layer(directory, Some(RECYCLED_DIR), true)?);
    if notes.len() > MAX_NOTES {
        return Err(format!(
            "笔记文件夹里有 {} 篇笔记，超过 {} 篇上限，请移出部分文件后重试",
            notes.len(),
            MAX_NOTES
        ));
    }
    let active_id = settings
        .active_id
        .filter(|id| notes.iter().any(|note| note.id == *id));
    Ok(Payload {
        version: 1,
        notes,
        active_id,
        theme: settings.theme,
        format: settings.format,
    })
}

fn read_workspace_settings(directory: &Path) -> Result<WorkspaceSettings, String> {
    let path = directory.join(WORKSPACE_FILE);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(WorkspaceSettings {
                version: 1,
                active_id: None,
                theme: "light".into(),
                format: FormatSettings::default(),
            });
        }
        Err(error) => return Err(format!("无法读取笔记：{error}")),
    };
    // 旧版清单格式（notes 内联）先迁移成 .txt 文件，再读取设置
    let probe: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("笔记文件损坏，原文件已保留：{error}"))?;
    if probe.get("notes").is_some() {
        migrate_legacy(directory)?;
        let fresh = fs::read(&path).map_err(|error| format!("无法读取笔记：{error}"))?;
        let settings: WorkspaceSettings = serde_json::from_slice(&fresh)
            .map_err(|error| format!("笔记文件损坏，原文件已保留：{error}"))?;
        settings.format.validate()?;
        return Ok(settings);
    }
    let settings: WorkspaceSettings = serde_json::from_slice(&bytes)
        .map_err(|error| format!("笔记文件损坏，原文件已保留：{error}"))?;
    if !valid_theme(&settings.theme) {
        return Err("主题配置无效".into());
    }
    settings.format.validate()?;
    Ok(settings)
}

/// 旧版单文件工作区（notes 内联）的迁移：正文写成 .txt、废纸篓移入 recycled/，
/// workspace.json 重写为只含设置；原文件备份为 workspace.json.bak。
fn migrate_legacy(directory: &Path) -> Result<(), String> {
    let path = directory.join(WORKSPACE_FILE);
    let bytes = fs::read(&path).map_err(|error| format!("无法读取笔记：{error}"))?;
    let stored: Stored = serde_json::from_slice(&bytes)
        .map_err(|error| format!("笔记文件损坏，原文件已保留：{error}"))?;
    if stored.version != 1 {
        return Err("笔记版本不受支持".into());
    }
    if !valid_theme(&stored.theme) {
        return Err("主题配置无效".into());
    }
    let format = stored.format.clone().unwrap_or_default();
    format.validate()?;
    fs::copy(&path, directory.join("workspace.json.bak"))
        .map_err(|error| format!("备份笔记失败：{error}"))?;
    fs::create_dir_all(directory.join(RECYCLED_DIR))
        .map_err(|error| format!("无法创建废纸篓目录：{error}"))?;
    let mut used: HashSet<String> = HashSet::new();
    for entry in fs::read_dir(directory).map_err(|error| format!("无法读取笔记目录：{error}"))?
    {
        let entry = entry.map_err(|error| format!("无法读取笔记目录：{error}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".txt") {
            used.insert(name);
        }
    }
    for note in &stored.notes {
        let filename = match note.filename.as_deref().filter(|name| !name.is_empty()) {
            Some(filename) => filename.to_string(),
            None => unique_name(slugify(&note.title, &note.id), &used),
        };
        used.insert(filename.clone());
        let target_dir = if note.trashed {
            directory.join(RECYCLED_DIR)
        } else {
            directory.to_path_buf()
        };
        let target = target_dir.join(&filename);
        if !target.exists() {
            if let Some(body) = note.body.as_deref() {
                write_atomic(&target, body.as_bytes())
                    .map_err(|error| format!("迁移笔记 {filename} 失败：{error}"))?;
            }
        }
    }
    let settings = WorkspaceSettings {
        version: 1,
        active_id: stored.active_id.clone(),
        theme: stored.theme.clone(),
        format,
    };
    let out = serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?;
    write_atomic(&path, &out).map_err(|error| format!("替换笔记文件失败：{error}"))
}

pub fn save_settings(
    directory: &Path,
    theme: &str,
    active_id: Option<&str>,
    format: &FormatSettings,
) -> Result<(), String> {
    if !valid_theme(theme) {
        return Err("主题配置无效".into());
    }
    format.validate()?;
    // 当前笔记必须真实存在（数据目录或 recycled/），否则丢弃引用
    let mut used: HashSet<String> = HashSet::new();
    for place in [directory.to_path_buf(), directory.join(RECYCLED_DIR)] {
        if let Ok(entries) = fs::read_dir(&place) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".txt") {
                    used.insert(name);
                }
            }
        }
    }
    let active_id = active_id.filter(|id| {
        let name = id.strip_prefix("recycled/").unwrap_or(id);
        used.contains(name)
    });
    let settings = WorkspaceSettings {
        version: 1,
        active_id: active_id.map(|id| id.to_string()),
        theme: theme.to_string(),
        format: format.clone(),
    };
    let bytes = serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?;
    fs::create_dir_all(directory).map_err(|error| format!("无法创建笔记目录：{error}"))?;
    write_atomic(&directory.join(WORKSPACE_FILE), &bytes)
        .map_err(|error| format!("替换笔记文件失败：{error}"))
}

// 会话内笔记可能在数据目录与 recycled/ 之间移动，而前端 id 恒为无前缀形态：
// 写/删/确保都以「两个位置里真实存在的那份」为准。
fn locate_note(directory: &Path, note_id: &str) -> Result<(PathBuf, bool), String> {
    let (normal, recycled_path) = resolve_pair(directory, note_id)?;
    if normal.exists() {
        return Ok((normal, false));
    }
    if recycled_path.exists() {
        return Ok((recycled_path, true));
    }
    Ok((normal, false))
}

fn resolve_pair(directory: &Path, note_id: &str) -> Result<(PathBuf, PathBuf), String> {
    let (normal, _) = resolve_note_path(directory, note_id)?;
    let recycled_path = directory.join(RECYCLED_DIR).join(
        normal
            .file_name()
            .map(|stem| stem.to_os_string())
            .ok_or("笔记文件名无效")?,
    );
    Ok((normal, recycled_path))
}

/// 写单篇笔记（新建与覆盖同一路径；文件不存在即创建）。
pub fn write_note(directory: &Path, note_id: &str, body: &str) -> Result<(), String> {
    let (path, _) = locate_note(directory, note_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建笔记目录：{error}"))?;
    }
    write_atomic(&path, body.as_bytes()).map_err(|error| format!("保存笔记失败：{error}"))
}

/// 废纸篓进出：文件在数据目录与 recycled/ 之间改名。
pub fn move_note(directory: &Path, note_id: &str, to_recycled: bool) -> Result<(), String> {
    let (normal, recycled_path) = resolve_pair(directory, note_id)?;
    fs::create_dir_all(directory.join(RECYCLED_DIR))
        .map_err(|error| format!("无法创建废纸篓目录：{error}"))?;
    let (source, target) = if to_recycled {
        (normal, recycled_path)
    } else {
        (recycled_path, normal)
    };
    if !source.exists() {
        return Err("笔记文件不存在".into());
    }
    if target.exists() {
        return Err("同名文件已存在".into());
    }
    fs::rename(&source, &target).map_err(|error| format!("无法移动笔记：{error}"))
}

/// 永久删除单篇笔记文件：数据目录与 recycled/ 两个位置都清理；不存在时视为成功。
pub fn delete_note(directory: &Path, note_id: &str) -> Result<(), String> {
    let (normal, recycled_path) = resolve_pair(directory, note_id)?;
    for path in [normal, recycled_path] {
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("无法删除笔记：{error}")),
        }
    }
    Ok(())
}

/// 运行期间文件被外部删除时：点击笔记即按已知信息（文件名与首行标题）重建同名文件。
pub fn ensure_note(directory: &Path, note_id: &str, title: &str) -> Result<bool, String> {
    let (normal, recycled_path) = resolve_pair(directory, note_id)?;
    if normal.exists() || recycled_path.exists() {
        return Ok(false);
    }
    fs::create_dir_all(directory).map_err(|error| format!("无法创建笔记目录：{error}"))?;
    write_atomic(&normal, format!("# {title}\n").as_bytes())
        .map_err(|error| format!("无法重建笔记：{error}"))?;
    Ok(true)
}

/// 新建笔记：标题生成唯一文件名，正文落盘，返回笔记。
pub fn create_note(directory: &Path, title: &str, body: &str) -> Result<PayloadNote, String> {
    fs::create_dir_all(directory).map_err(|error| format!("无法创建笔记目录：{error}"))?;
    let mut used: HashSet<String> = HashSet::new();
    for place in [directory.to_path_buf(), directory.join(RECYCLED_DIR)] {
        if let Ok(entries) = fs::read_dir(&place) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".txt") {
                    used.insert(name);
                }
            }
        }
    }
    if used.len() >= MAX_NOTES {
        return Err(format!("笔记数量已达 {} 篇上限", MAX_NOTES));
    }
    let filename = unique_name(slugify(title, "未命名"), &used);
    let body = if body.is_empty() {
        format!("# {title}\n")
    } else {
        body.to_string()
    };
    write_atomic(&directory.join(&filename), body.as_bytes())
        .map_err(|error| format!("保存笔记失败：{error}"))?;
    let (created_at, updated_at) = file_timestamps(&directory.join(&filename));
    let stem = filename
        .strip_suffix(".txt")
        .unwrap_or(&filename)
        .to_string();
    Ok(PayloadNote {
        id: filename.clone(),
        filename: String::new(),
        title: derive_title(&body, &stem),
        body,
        created_at,
        updated_at,
        trashed: false,
    })
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Settings {
    data_directory: Option<PathBuf>,
}

pub struct Store {
    pub config: PathBuf,
    pub default: PathBuf,
    pub legacy: Option<PathBuf>,
}

/// 上次关闭时的主窗尺寸（逻辑单位），存默认数据目录 ~/.calcbook/window.json。
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSize {
    pub width: f64,
    pub height: f64,
}

/// 与 tauri.conf.json 的 minWidth/minHeight 保持一致。
pub const MIN_WINDOW_WIDTH: f64 = 800.0;
pub const MIN_WINDOW_HEIGHT: f64 = 640.0;

impl WindowSize {
    /// 钳制到主窗最小尺寸，恢复时不会比最小窗口还小。
    pub fn clamped(self) -> Self {
        Self {
            width: self.width.max(MIN_WINDOW_WIDTH),
            height: self.height.max(MIN_WINDOW_HEIGHT),
        }
    }
}

impl Store {
    /// 读取上次记录的窗口尺寸；文件缺失或损坏时返回 None（回退最小尺寸）。
    pub fn window_size(&self) -> Option<WindowSize> {
        let bytes = fs::read(self.default.join("window.json")).ok()?;
        let size: WindowSize = serde_json::from_slice(&bytes).ok()?;
        (size.width.is_finite() && size.height.is_finite()).then_some(size)
    }

    /// 记录窗口尺寸：先钳制到最小尺寸，再按既有模式原子写入。
    pub fn save_window_size(&self, size: WindowSize) -> Result<(), String> {
        let size = size.clamped();
        fs::create_dir_all(&self.default).map_err(|error| format!("无法创建数据目录：{error}"))?;
        let bytes = serde_json::to_vec_pretty(&size)
            .map_err(|error| format!("无法序列化窗口尺寸：{error}"))?;
        let temporary = self.default.join("window.json.tmp");
        let mut file =
            fs::File::create(&temporary).map_err(|error| format!("无法暂存窗口尺寸：{error}"))?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|error| format!("窗口尺寸未保存：{error}"))?;
        drop(file);
        fs::rename(temporary, self.default.join("window.json"))
            .map_err(|error| format!("窗口尺寸未保存：{error}"))?;
        Ok(())
    }

    fn settings(&self) -> Result<Settings, String> {
        let path = self.config.join("settings.json");
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Settings::default())
            }
            Err(error) => return Err(format!("无法读取存储配置：{error}")),
        };
        let settings: Settings = serde_json::from_slice(&bytes)
            .map_err(|error| format!("存储配置损坏，原文件已保留：{error}"))?;
        if settings
            .data_directory
            .as_ref()
            .is_some_and(|path| !path.is_absolute())
        {
            return Err("存储目录必须是绝对路径，原配置已保留".into());
        }
        Ok(settings)
    }

    pub fn directory(&self) -> Result<PathBuf, String> {
        Ok(self
            .settings()?
            .data_directory
            .unwrap_or_else(|| self.default.clone()))
    }

    pub fn load(&self) -> Result<Option<Payload>, String> {
        let settings = self.settings()?;
        let directory = settings.data_directory.as_ref().unwrap_or(&self.default);
        let has_own = directory.join(WORKSPACE_FILE).exists()
            || directory.join(RECYCLED_DIR).exists()
            || fs::read_dir(directory)
                .map(|entries| {
                    entries
                        .flatten()
                        .any(|entry| entry.file_name().to_string_lossy().ends_with(".txt"))
                })
                .unwrap_or(false);
        if has_own {
            return Ok(Some(scan(directory)?));
        }
        if settings.data_directory.is_some() {
            return Err("指定目录中没有任何笔记，请检查磁盘或恢复文件后重试".into());
        }
        if let Some(legacy) = self.legacy.as_ref().filter(|path| *path != directory) {
            let has_legacy = fs::read_dir(legacy)
                .map(|entries| {
                    entries.flatten().any(|entry| {
                        let name = entry.file_name().to_string_lossy().to_string();
                        name == WORKSPACE_FILE || name.ends_with(".txt")
                    })
                })
                .unwrap_or(false);
            if has_legacy {
                let payload = scan(legacy)?;
                // 旧目录的文件全部搬进当前数据目录（recycled/ 结构原样保留）
                for note in &payload.notes {
                    let source = legacy.join(&note.id);
                    let target = directory.join(&note.id);
                    if let Some(parent) = target.parent() {
                        fs::create_dir_all(parent)
                            .map_err(|error| format!("无法创建笔记目录：{error}"))?;
                    }
                    fs::rename(&source, &target)
                        .or_else(|_| fs::copy(&source, &target).map(|_| ()))
                        .map_err(|error| format!("无法迁移旧笔记：{error}"))?;
                }
                let _ = fs::remove_file(legacy.join(WORKSPACE_FILE));
                return Ok(Some(scan(directory)?));
            }
        }
        Ok(None)
    }

    /// 换目录：目标文件夹必须是空的（没有 .txt 与 workspace.json），否则拒绝覆盖；
    /// 把全部笔记文件、recycled/ 与 workspace.json 复制过去后再提交配置。
    pub fn relocate(&self, target: &Path) -> Result<(), String> {
        let target =
            fs::canonicalize(target).map_err(|error| format!("无法打开所选目录：{error}"))?;
        if !target.is_dir() {
            return Err("请选择一个文件夹".into());
        }
        let current = self.directory()?;
        if fs::canonicalize(&current).ok().as_ref() == Some(&target) {
            return Ok(());
        }
        let occupied = fs::read_dir(&target)
            .map_err(|error| format!("无法读取所选目录：{error}"))?
            .flatten()
            .any(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                name.ends_with(".txt") || name == WORKSPACE_FILE
            });
        if occupied {
            return Err("所选文件夹已包含笔记，未覆盖。请选择空文件夹".into());
        }
        let payload = scan(&current)?;
        for note in &payload.notes {
            let source = current.join(&note.id);
            let target_path = target.join(&note.id);
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(|error| format!("无法创建笔记目录：{error}"))?;
            }
            fs::copy(&source, &target_path).map_err(|error| format!("无法复制笔记：{error}"))?;
        }
        if current.join(RECYCLED_DIR).exists() {
            fs::create_dir_all(target.join(RECYCLED_DIR))
                .map_err(|error| format!("无法创建废纸篓目录：{error}"))?;
        }
        let bytes = fs::read(current.join(WORKSPACE_FILE)).unwrap_or_default();
        if !bytes.is_empty() {
            fs::write(target.join(WORKSPACE_FILE), &bytes)
                .map_err(|error| format!("无法复制笔记：{error}"))?;
        }
        // 提交配置：失败时原目录保持不变
        fs::create_dir_all(&self.config).map_err(|error| format!("无法创建配置目录：{error}"))?;
        let settings_bytes = serde_json::to_vec(&Settings {
            data_directory: Some(target.clone()),
        })
        .map_err(|error| error.to_string())?;
        let temporary = self.config.join("settings.json.tmp");
        let mut file =
            fs::File::create(&temporary).map_err(|error| format!("无法暂存配置：{error}"))?;
        file.write_all(&settings_bytes)
            .and_then(|()| file.sync_all())
            .map_err(|error| format!("存储位置未改变：{error}"))?;
        drop(file);
        fs::rename(temporary, self.config.join("settings.json"))
            .map_err(|error| format!("存储位置未改变：{error}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn window_size_round_trips_clamps_and_rejects_garbage() {
        let root = temporary("window-size");
        let store = Store {
            config: root.join("config"),
            default: root.join("data"),
            legacy: None,
        };
        // 无记录时回退 None（启动侧再用最小尺寸兜底）
        assert_eq!(store.window_size(), None);
        // 正常往返
        store
            .save_window_size(WindowSize {
                width: 1280.0,
                height: 820.0,
            })
            .unwrap();
        assert_eq!(
            store.window_size(),
            Some(WindowSize {
                width: 1280.0,
                height: 820.0,
            })
        );
        // 保存时钳制到最小尺寸
        store
            .save_window_size(WindowSize {
                width: 500.0,
                height: 400.0,
            })
            .unwrap();
        assert_eq!(
            store.window_size(),
            Some(WindowSize {
                width: MIN_WINDOW_WIDTH,
                height: MIN_WINDOW_HEIGHT,
            })
        );
        // 损坏文件视为无记录，不阻塞启动
        fs::write(store.default.join("window.json"), "not json").unwrap();
        assert_eq!(store.window_size(), None);
    }

    fn temporary(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("calcbook-{name}-{unique}"))
    }

    #[test]
    fn scan_reads_txt_files_with_recycled_and_titles() {
        let directory = temporary("scan");
        fs::create_dir_all(directory.join(RECYCLED_DIR)).unwrap();
        fs::write(directory.join("预算.txt"), "# 旅行预算\n交通 = 186").unwrap();
        fs::write(directory.join("b.txt"), "没有标题的笔记").unwrap();
        fs::write(directory.join(RECYCLED_DIR).join("旧.txt"), "# 旧的").unwrap();
        fs::write(directory.join("notes.md"), "不是笔记").unwrap();

        let payload = scan(&directory).unwrap();
        let ids: Vec<&str> = payload.notes.iter().map(|note| note.id.as_str()).collect();
        assert_eq!(ids, ["预算.txt", "b.txt", "recycled/旧.txt"]);
        assert_eq!(payload.notes[0].title, "旅行预算");
        assert!(!payload.notes[0].trashed);
        assert_eq!(payload.notes[1].title, "b");
        assert!(payload.notes[2].trashed);
        assert!(payload
            .notes
            .iter()
            .all(|note| !note.created_at.is_empty() && !note.updated_at.is_empty()));
        // 外部删除文件后，下一次扫描自动同步
        fs::remove_file(directory.join("b.txt")).unwrap();
        let payload = scan(&directory).unwrap();
        assert_eq!(payload.notes.len(), 2);
        // 外部新增文件也会被引入
        fs::write(directory.join("新增.txt"), "# 新的").unwrap();
        assert_eq!(scan(&directory).unwrap().notes.len(), 3);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn write_move_delete_and_ensure_cover_the_file_lifecycle() {
        let directory = temporary("lifecycle");
        write_note(&directory, "预算.txt", "# 预算\n100").unwrap();
        assert_eq!(
            fs::read_to_string(directory.join("预算.txt")).unwrap(),
            "# 预算\n100"
        );
        write_note(&directory, "预算.txt", "# 预算\n200").unwrap();
        assert_eq!(
            fs::read_to_string(directory.join("预算.txt")).unwrap(),
            "# 预算\n200"
        );
        // 进出废纸篓
        move_note(&directory, "预算.txt", true).unwrap();
        assert!(directory.join(RECYCLED_DIR).join("预算.txt").exists());
        assert!(!directory.join("预算.txt").exists());
        move_note(&directory, "预算.txt", false).unwrap();
        assert!(directory.join("预算.txt").exists());
        // 目标同名冲突
        write_note(&directory, "recycled/预算.txt", "占位").unwrap();
        assert!(move_note(&directory, "预算.txt", true).is_err());
        fs::remove_file(directory.join(RECYCLED_DIR).join("预算.txt")).unwrap();
        // 运行时外部删除：ensure 按已知信息（文件名与首行标题）重建
        fs::remove_file(directory.join("预算.txt")).unwrap();
        assert!(ensure_note(&directory, "预算.txt", "预算").unwrap());
        assert_eq!(
            fs::read_to_string(directory.join("预算.txt")).unwrap(),
            "# 预算\n"
        );
        assert!(!ensure_note(&directory, "预算.txt", "预算").unwrap());
        // 永久删除（recycled 内）
        move_note(&directory, "预算.txt", true).unwrap();
        delete_note(&directory, "recycled/预算.txt").unwrap();
        assert!(!directory.join(RECYCLED_DIR).join("预算.txt").exists());
        // 越界路径被拒绝
        assert!(resolve_note_path(&directory, "../escape.txt").is_err());
        assert!(resolve_note_path(&directory, "recycled/../escape.txt").is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn legacy_workspace_migrates_into_files_and_recycled() {
        let directory = temporary("migrate");
        fs::create_dir_all(&directory).unwrap();
        let legacy = serde_json::json!({
            "version": 1,
            "notes": [
                {
                    "id": "note-1",
                    "title": "人体消耗计算",
                    "body": "# 人体消耗计算\nBMR = 1,566.25",
                    "createdAt": "2026-09-06T00:00:00.000Z",
                    "updatedAt": "2026-09-06T00:00:00.000Z",
                    "trashed": false
                },
                {
                    "id": "note-2",
                    "title": "废纸篓里的",
                    "body": "旧的",
                    "createdAt": "2026-09-06T00:00:00.000Z",
                    "updatedAt": "2026-09-06T00:00:00.000Z",
                    "trashed": true
                }
            ],
            "activeId": "note-1",
            "theme": "dark",
            "format": {
                "operatorSpace": true,
                "commentSpace": true,
                "unitStyle": "free",
                "unitSystem": "free"
            }
        });
        fs::write(
            directory.join(WORKSPACE_FILE),
            serde_json::to_vec(&legacy).unwrap(),
        )
        .unwrap();

        let payload = scan(&directory).unwrap();
        assert_eq!(payload.theme, "dark");
        assert_eq!(payload.notes.len(), 2);
        assert_eq!(payload.notes[0].id, "人体消耗计算.txt");
        assert_eq!(
            fs::read_to_string(directory.join("人体消耗计算.txt")).unwrap(),
            "# 人体消耗计算\nBMR = 1,566.25"
        );
        assert_eq!(payload.notes[1].id, "recycled/废纸篓里的.txt");
        assert!(directory.join(RECYCLED_DIR).join("废纸篓里的.txt").exists());
        // workspace.json 重写为只含设置，旧文件留了备份
        let meta = fs::read_to_string(directory.join(WORKSPACE_FILE)).unwrap();
        assert!(!meta.contains("BMR"));
        assert!(directory.join("workspace.json.bak").exists());
        // 迁移后再扫描稳定
        assert_eq!(scan(&directory).unwrap(), payload);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn settings_validation_drops_stale_active_note() {
        let directory = temporary("settings");
        write_note(&directory, "预算.txt", "# 预算").unwrap();
        save_settings(
            &directory,
            "dark",
            Some("预算.txt"),
            &FormatSettings::default(),
        )
        .unwrap();
        let payload = scan(&directory).unwrap();
        assert_eq!(payload.active_id.as_deref(), Some("预算.txt"));
        assert_eq!(payload.theme, "dark");
        // 主题非法被拒绝
        assert!(save_settings(&directory, "nope", None, &FormatSettings::default()).is_err());
        // 当前笔记文件被外部删除后，保存设置时丢弃引用
        fs::remove_file(directory.join("预算.txt")).unwrap();
        save_settings(
            &directory,
            "light",
            Some("预算.txt"),
            &FormatSettings::default(),
        )
        .unwrap();
        let settings: WorkspaceSettings =
            serde_json::from_slice(&fs::read(directory.join(WORKSPACE_FILE)).unwrap()).unwrap();
        assert_eq!(settings.active_id, None);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn slugify_keeps_readable_names_and_rejects_path_traversal() {
        assert_eq!(slugify("人体消耗计算", "note-1"), "人体消耗计算.txt");
        assert_eq!(slugify("a/b:c", "note-1"), "a-b-c.txt");
        assert_eq!(slugify("  ..  ", "note-1"), "note-1.txt");
        assert_eq!(slugify("", "note-2"), "note-2.txt");
        assert!(validate_filename("预算.txt").is_ok());
        for name in ["", "预算", "../x.txt", "a/b.txt", ".hidden.txt", "预算.md"] {
            assert!(validate_filename(name).is_err(), "{name} 应被拒绝");
        }
    }

    #[test]
    fn relocate_refuses_occupied_target_and_copies_everything() {
        let root = temporary("relocate");
        let current = root.join("current");
        let target = root.join("target");
        fs::create_dir_all(current.join(RECYCLED_DIR)).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(current.join("a.txt"), "# A").unwrap();
        fs::write(current.join(RECYCLED_DIR).join("b.txt"), "# B").unwrap();
        save_settings(&current, "light", None, &FormatSettings::default()).unwrap();

        let store = Store {
            config: root.join("config"),
            default: current.clone(),
            legacy: None,
        };
        // 目标已有 .txt：拒绝
        fs::write(target.join("占位.txt"), "x").unwrap();
        assert!(store.relocate(&target).is_err());
        fs::remove_file(target.join("占位.txt")).unwrap();
        store.relocate(&target).unwrap();
        assert_eq!(
            store.directory().unwrap(),
            fs::canonicalize(&target).unwrap()
        );
        assert_eq!(fs::read_to_string(target.join("a.txt")).unwrap(), "# A");
        assert_eq!(
            fs::read_to_string(target.join(RECYCLED_DIR).join("b.txt")).unwrap(),
            "# B"
        );
        assert!(target.join(WORKSPACE_FILE).exists());
        fs::remove_dir_all(root).unwrap();
    }
}
