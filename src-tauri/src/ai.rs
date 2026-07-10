use std::{path::Path, time::Duration};

use chrono::Utc;
use reqwest::Client;
use tokio::time::timeout;
use uuid::Uuid;

use crate::db::{self, Database};
use crate::errors::{AppError, AppResult};
use crate::models::{
    AiTaskRun, AiTaskType, AiTriggerMode, Attachment, AttachmentType, CreateAiResultRequest,
    LearningAnalysisPayload, LearningAnalysisResult, LearningConversationMemoryWrite,
    LearningConversationPayload, LearningConversationResult, RunAiTaskRequest,
};

pub struct AiRuntimeSettings {
    pub provider: String,
    pub model: String,
    pub model_variant: String,
    pub api_key: String,
    pub base_url: Option<String>,
}

impl AiRuntimeSettings {
    fn resolved_model(&self) -> String {
        match self.provider.as_str() {
            "opencode" => {
                let variant_model = match self.model_variant.as_str() {
                    "deepseek-v4-flash-free" => Some("deepseek-v4-flash-free"),
                    _ => None,
                };

                variant_model
                    .or_else(|| {
                        (!self.model.trim().is_empty()).then_some(
                            self.model.trim().trim_start_matches("zen:"),
                        )
                    })
                    .unwrap_or("deepseek-v4-flash-free")
                    .into()
            }
            _ if !self.model.trim().is_empty() => self.model.trim().into(),
            _ => "claude-sonnet-4-20250514".into(),
        }
    }

    fn endpoint(&self) -> String {
        let base = self.base_url.as_deref().map(str::trim).unwrap_or("");
        if !base.is_empty() {
            return match self.provider.as_str() {
                "opencode" if !base.ends_with("/responses") => {
                    format!("{}/responses", base.trim_end_matches('/'))
                }
                "openai" if !base.ends_with("/chat/completions") => {
                    format!("{}/chat/completions", base.trim_end_matches('/'))
                }
                "claude" | "anthropic" if !base.ends_with("/messages") => {
                    format!("{}/messages", base.trim_end_matches('/'))
                }
                _ => base.into(),
            };
        }

        match self.provider.as_str() {
            "opencode" => "https://opencode.ai/zen/v1/responses".into(),
            "openai" => "https://api.openai.com/v1/chat/completions".into(),
            _ => "https://api.anthropic.com/v1/messages".into(),
        }
    }
}

fn build_http_client() -> AppResult<Client> {
    Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| AppError::State(format!("failed to build AI client: {error}")))
}

pub async fn run_task(database: &Database, request: RunAiTaskRequest) -> AppResult<AiTaskRun> {
    match request.task_type {
        AiTaskType::LearningAnalysis => run_learning_analysis(database, request.payload).await,
        AiTaskType::LearningConversation => {
            run_learning_conversation(database, request.payload).await
        }
        AiTaskType::WeeklyReport => run_weekly_report_placeholder(database, request.payload).await,
    }
}

pub fn load_ai_runtime_settings(conn: &rusqlite::Connection) -> AppResult<AiRuntimeSettings> {
    let provider = db::get_setting_or(conn, "ai_provider", "claude")?;
    let model = db::get_setting_or(conn, "ai_model", "claude-sonnet-4-20250514")?;
    let model_variant = db::get_setting_or(conn, "ai_model_variant", "default")?;
    let base_url = db::get_setting_or(conn, "ai_base_url", "")?;

    let api_key = db::get_setting(conn, "ai_api_key")?
        .map(|entry| entry.value)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            db::get_setting(conn, "claude_api_key")
                .ok()
                .flatten()
                .map(|entry| entry.value)
                .filter(|value| !value.trim().is_empty())
        })
        .unwrap_or_default();

    if api_key.trim().is_empty() && base_url.trim().is_empty() {
        return Err(AppError::Validation(
            "AI API key not configured. Set 'ai_api_key' or legacy 'claude_api_key' in settings."
                .into(),
        ));
    }

    Ok(AiRuntimeSettings {
        provider,
        model,
        model_variant,
        api_key,
        base_url: (!base_url.trim().is_empty()).then_some(base_url),
    })
}

fn persist_learning_memory_updates(
    conn: &rusqlite::Connection,
    record_id: &str,
    result: &LearningAnalysisResult,
) -> AppResult<()> {
    for update in &result.suggested_memory_updates {
        // Learning analysis can only propose candidate topics. Confirmed
        // understanding must come from a later pet-user dialog step.
        let topic = db::upsert_knowledge_topic(
            conn,
            &update.topic,
            &update.evidence,
            "candidate",
        )?;
        db::append_knowledge_evidence(
            conn,
            &topic.id,
            record_id,
            "analysis_suggestion",
            &update.evidence,
        )?;
    }

    Ok(())
}

fn build_learning_analysis_ai_result_request(
    record_id: &str,
    settings: &AiRuntimeSettings,
    result: &LearningAnalysisResult,
    result_json: &str,
) -> CreateAiResultRequest {
    CreateAiResultRequest {
        record_id: record_id.to_string(),
        trigger_mode: AiTriggerMode::Manual,
        model_provider: Some(settings.provider.clone()),
        model_name: Some(settings.model.clone()),
        summary: Some(result.summary.clone()),
        tags: None,
        suggested_tasks: None,
        research_result: Some(result_json.to_string()),
        sensitivity_flag: None,
    }
}

fn persist_learning_conversation(
    conn: &rusqlite::Connection,
    payload: LearningConversationPayload,
) -> AppResult<LearningConversationResult> {
    let topic = db::get_knowledge_topic(conn, &payload.topic_id)?;

    let user_requested_memory = payload
        .source_signals
        .iter()
        .any(|signal| signal == "user_requested_memory");
    let has_restatement = payload
        .source_signals
        .iter()
        .any(|signal| signal == "restatement");
    let has_application = payload
        .source_signals
        .iter()
        .any(|signal| signal == "application");
    let not_knowledge_point = payload
        .source_signals
        .iter()
        .any(|signal| signal == "not_knowledge_point");

    let (decision, reason, memory_write, next_action, next_status) = if not_knowledge_point {
        (
            "reject_candidate".to_string(),
            "用户认为这个候选项不应该作为知识点记录，因此将其标记为不是知识点。".to_string(),
            None,
            "hide_from_learning_candidates".to_string(),
            Some("rejected"),
        )
    } else if user_requested_memory {
        (
            "promote_to_understanding".to_string(),
            "用户主动要求把这个知识写入记忆，因此将候选知识升级为初步理解。".to_string(),
            Some(LearningConversationMemoryWrite {
                status: "understanding".into(),
                evidence_type: "user_confirm_request".into(),
            }),
            "continue_observing_in_future_tasks".to_string(),
            Some("understanding"),
        )
    } else if has_restatement {
        (
            "promote_to_understanding".to_string(),
            "用户已经能用自己的话复述这个知识点，因此将候选知识升级为初步理解。".to_string(),
            Some(LearningConversationMemoryWrite {
                status: "understanding".into(),
                evidence_type: "dialog_answer".into(),
            }),
            "continue_observing_in_future_tasks".to_string(),
            Some("understanding"),
        )
    } else if has_application {
        (
            "promote_to_understanding".to_string(),
            "用户已经能把这个知识应用到实际问题，因此将候选知识升级为初步理解。".to_string(),
            Some(LearningConversationMemoryWrite {
                status: "understanding".into(),
                evidence_type: "task_practice".into(),
            }),
            "continue_observing_in_future_tasks".to_string(),
            Some("understanding"),
        )
    } else {
        (
            "keep_candidate".to_string(),
            "当前只有候选知识，尚未获得足够的确认信号。".to_string(),
            None,
            "continue_dialog".to_string(),
            None,
        )
    };

    let result = LearningConversationResult {
        topic: topic.name.clone(),
        decision: decision.clone(),
        reason: reason.clone(),
        memory_write: memory_write.clone(),
        next_action,
    };

    if let Some(status) = next_status {
        db::update_knowledge_topic_status(conn, &topic.id, &topic.summary, status)?;
        let evidence_type = memory_write
            .as_ref()
            .map(|write| write.evidence_type.as_str())
            .unwrap_or(if status == "rejected" { "user_rejected_candidate" } else { "dialog_answer" });
        db::append_knowledge_evidence(
            conn,
            &topic.id,
            &payload.source_record_id,
            evidence_type,
            &reason,
        )?;
    }

    db::insert_learning_dialog_session(
        conn,
        crate::models::LearningDialogSession {
            id: payload
                .dialog_session_id
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
            topic_id: payload.topic_id,
            source_record_id: payload.source_record_id,
            status: decision,
            conversation_snapshot: serde_json::to_string(&payload.messages).unwrap_or_else(|_| "[]".into()),
            conclusion_json: Some(
                serde_json::to_string(&result)
                    .map_err(|error| AppError::State(format!("failed to serialize conversation result: {error}")))?,
            ),
            created_at: Utc::now(),
        },
    )?;

    Ok(result)
}

async fn run_learning_analysis(
    database: &Database,
    payload: serde_json::Value,
) -> AppResult<AiTaskRun> {
    let payload: LearningAnalysisPayload = serde_json::from_value(payload)
        .map_err(|error| AppError::Validation(format!("invalid learning_analysis payload: {error}")))?;

    if payload.record_id.trim().is_empty() {
        return Err(AppError::Validation("recordId is required".into()));
    }

    let (settings, record, attachments) = {
        let conn = database.conn.lock()?;
        let settings = load_ai_runtime_settings(&conn)?;
        let record = db::get_record(&conn, &payload.record_id)?;
        let attachments = db::get_attachments_for_record(&conn, &payload.record_id)?;
        (settings, record, attachments)
    };

    let pending_run = AiTaskRun {
        id: Uuid::new_v4().to_string(),
        task_type: AiTaskType::LearningAnalysis,
        source_record_id: Some(record.id.clone()),
        status: "running".into(),
        model_provider: Some(settings.provider.clone()),
        model_name: Some(settings.model.clone()),
        model_variant: Some(settings.model_variant.clone()),
        input_snapshot: serde_json::to_string(&payload)
            .unwrap_or_else(|_| "{\"recordId\":\"serialization-error\"}".into()),
        result_json: None,
        error_message: None,
        created_at: Utc::now(),
    };

    {
        let conn = database.conn.lock()?;
        db::insert_ai_task_run(&conn, pending_run.clone())?;
    }

    let response = run_model_request(&settings, &record.title, &record.content, record.source.as_str(), &attachments).await;

    match response {
        Ok(result) => {
            let result_json = serde_json::to_string(&result)
                .map_err(|error| AppError::State(format!("failed to serialize learning result: {error}")))?;

            let updated_run = {
                let conn = database.conn.lock()?;
                let updated = db::update_ai_task_run_result(
                    &conn,
                    &pending_run.id,
                    "success",
                    Some(&result_json),
                    None,
                )?;
                persist_learning_memory_updates(&conn, &record.id, &result)?;
                let ai_result = db::insert_ai_result(
                    &conn,
                    build_learning_analysis_ai_result_request(
                        &record.id,
                        &settings,
                        &result,
                        &result_json,
                    ),
                )?;
                eprintln!(
                    "[ai] persisted learning analysis record_id={} ai_result_id={} research_result_bytes={}",
                    record.id,
                    ai_result.id,
                    result_json.len()
                );
                updated
            };

            Ok(updated_run)
        }
        Err(error) => {
            let message = error.to_string();
            if let Ok(conn) = database.conn.lock() {
                let _ = db::update_ai_task_run_result(
                    &conn,
                    &pending_run.id,
                    "failed",
                    None,
                    Some(&message),
                );
            }
            Err(error)
        }
    }
}

async fn run_learning_conversation(
    database: &Database,
    payload: serde_json::Value,
) -> AppResult<AiTaskRun> {
    let payload: LearningConversationPayload = serde_json::from_value(payload)
        .map_err(|error| AppError::Validation(format!("invalid learning_conversation payload: {error}")))?;

    if payload.topic_id.trim().is_empty() {
        return Err(AppError::Validation("topicId is required".into()));
    }
    if payload.source_record_id.trim().is_empty() {
        return Err(AppError::Validation("sourceRecordId is required".into()));
    }

    let pending_run = AiTaskRun {
        id: Uuid::new_v4().to_string(),
        task_type: AiTaskType::LearningConversation,
        source_record_id: Some(payload.source_record_id.clone()),
        status: "running".into(),
        model_provider: None,
        model_name: None,
        model_variant: None,
        input_snapshot: serde_json::to_string(&payload).unwrap_or_else(|_| "{}".into()),
        result_json: None,
        error_message: None,
        created_at: Utc::now(),
    };

    {
        let conn = database.conn.lock()?;
        db::insert_ai_task_run(&conn, pending_run.clone())?;
    }

    let result_json = {
        let conn = database.conn.lock()?;
        let result = persist_learning_conversation(&conn, payload)?;
        serde_json::to_string(&result)
            .map_err(|error| AppError::State(format!("failed to serialize conversation result: {error}")))?
    };

    let conn = database.conn.lock()?;
    db::update_ai_task_run_result(
        &conn,
        &pending_run.id,
        "success",
        Some(&result_json),
        None,
    )
}

async fn run_weekly_report_placeholder(
    database: &Database,
    payload: serde_json::Value,
) -> AppResult<AiTaskRun> {
    let settings = {
        let conn = database.conn.lock()?;
        load_ai_runtime_settings(&conn)?
    };

    let pending_run = AiTaskRun {
        id: Uuid::new_v4().to_string(),
        task_type: AiTaskType::WeeklyReport,
        source_record_id: None,
        status: "failed".into(),
        model_provider: Some(settings.provider),
        model_name: Some(settings.model),
        model_variant: Some(settings.model_variant),
        input_snapshot: serde_json::to_string(&payload).unwrap_or_else(|_| "{}".into()),
        result_json: None,
        error_message: Some("weekly_report is not implemented in phase 1".into()),
        created_at: Utc::now(),
    };

    let conn = database.conn.lock()?;
    db::insert_ai_task_run(&conn, pending_run.clone())?;
    Ok(pending_run)
}

async fn run_model_request(
    settings: &AiRuntimeSettings,
    title: &Option<String>,
    content: &Option<String>,
    source: &str,
    attachments: &[Attachment],
) -> AppResult<LearningAnalysisResult> {
    match settings.provider.as_str() {
        "claude" | "anthropic" => run_anthropic_learning_request(settings, title, content, source, attachments).await,
        "openai" | "opencode" => {
            run_openai_compatible_learning_request(settings, title, content, source, attachments).await
        }
        other => Err(AppError::Validation(format!(
            "unsupported ai_provider '{other}' for phase 1"
        ))),
    }
}

async fn run_anthropic_learning_request(
    settings: &AiRuntimeSettings,
    title: &Option<String>,
    content: &Option<String>,
    source: &str,
    attachments: &[Attachment],
) -> AppResult<LearningAnalysisResult> {
    let mut text = String::new();
    if let Some(title) = title {
        text.push_str(&format!("Title: {title}\n\n"));
    }
    if let Some(content) = content {
        text.push_str(&format!("Content: {content}\n\n"));
    }
    text.push_str(&format!("Source: {source}"));

    let image_attachment = attachments
        .iter()
        .find(|a| a.file_type == AttachmentType::Image || a.file_type == AttachmentType::Screenshot);

    let system_prompt = r#"You are an AI learning assistant. Analyze the provided note and return ONLY a raw JSON object (no markdown, no code fences) with these fields:
{
  "knowledge_points": [
    {
      "name": "knowledge point name",
      "confidence": 0.0,
      "example_from_note": "specific example from the note"
    }
  ],
  "questions_for_user": ["short follow-up question"],
  "suggested_memory_updates": [
    {
      "topic": "knowledge point name",
      "mastery_level": "candidate",
      "evidence": "why this topic should be discussed with the user next"
    }
  ],
  "summary": "concise learning-oriented summary"
}"#;

    let mut content_blocks: Vec<serde_json::Value> = vec![serde_json::json!({
        "type": "text",
        "text": format!("Please analyze this note for learning interaction preparation:\n\n{text}")
    })];

    if let Some(att) = image_attachment {
        let path = Path::new(&att.local_path);
        if path.exists() {
            if let Ok(bytes) = std::fs::read(path) {
                use base64::Engine;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                let media_type = match att.mime_type.as_str() {
                    "image/png" | "image/jpeg" | "image/webp" => att.mime_type.as_str(),
                    _ => "image/png",
                };
                content_blocks.push(serde_json::json!({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": b64
                    }
                }));
            }
        }
    }

    let request_body = serde_json::json!({
        "model": settings.resolved_model(),
        "max_tokens": 4096,
        "system": system_prompt,
        "thinking": { "type": "adaptive" },
        "messages": [
            {
                "role": "user",
                "content": content_blocks
            }
        ]
    });

    let endpoint = settings.endpoint();

    let mut request = build_http_client()?
        .post(endpoint)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json");
    if !settings.api_key.trim().is_empty() {
        request = request.header("x-api-key", &settings.api_key);
    }
    let response = request
        .json(&request_body)
        .send()
        .await
        .map_err(|error| AppError::State(format!("AI request failed: {error}")))?;

    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| AppError::State(format!("failed to read AI response: {error}")))?;
    eprintln!(
        "[ai] openai-compatible body preview {}",
        response_preview(&response_text, 280)
    );

    if !status.is_success() {
        return Err(AppError::State(format!(
            "AI provider returned {status}: {response_text}"
        )));
    }

    let response_json: serde_json::Value = serde_json::from_str(&response_text)
        .map_err(|error| AppError::State(format!("failed to parse AI JSON: {error}")))?;

    let raw_text = response_json["content"]
        .as_array()
        .and_then(|blocks| {
            blocks
                .iter()
                .find_map(|block| (block["type"] == "text").then(|| block["text"].as_str()))
                .flatten()
        })
        .unwrap_or("");

    let cleaned = if raw_text.starts_with("```") {
        raw_text
            .lines()
            .skip(1)
            .take_while(|line| !line.starts_with("```"))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        raw_text.to_string()
    };

    serde_json::from_str(&cleaned).or_else(|_| {
        Ok(LearningAnalysisResult {
            knowledge_points: vec![],
            questions_for_user: vec![],
            suggested_memory_updates: vec![],
            summary: raw_text.to_string(),
        })
    })
}

async fn run_openai_compatible_learning_request(
    settings: &AiRuntimeSettings,
    title: &Option<String>,
    content: &Option<String>,
    source: &str,
    attachments: &[Attachment],
) -> AppResult<LearningAnalysisResult> {
    let mut text = String::new();
    if let Some(title) = title {
        text.push_str(&format!("Title: {title}\n\n"));
    }
    if let Some(content) = content {
        text.push_str(&format!("Content: {content}\n\n"));
    }
    text.push_str(&format!("Source: {source}"));

    let system_prompt = r#"You are an AI learning assistant. Analyze the provided note and return ONLY a raw JSON object (no markdown, no code fences) with these fields:
{
  "knowledge_points": [
    {
      "name": "knowledge point name",
      "confidence": 0.0,
      "example_from_note": "specific example from the note"
    }
  ],
  "questions_for_user": ["short follow-up question"],
  "suggested_memory_updates": [
    {
      "topic": "knowledge point name",
      "mastery_level": "candidate",
      "evidence": "why this topic should be discussed with the user next"
    }
  ],
  "summary": "concise learning-oriented summary"
}"#;

    // Zen free is much more stable with plain text inputs. We preserve any OCR
    // we already have from attachments, but avoid forwarding image payloads that
    // can cause upstream provider failures.
    let user_content = build_openai_compatible_user_content(&text, attachments, false);

    let resolved_model = settings.resolved_model();
    let request_body = build_openai_compatible_request_body(
        &resolved_model,
        system_prompt,
        user_content,
    );

    let endpoint = settings.endpoint();
    eprintln!(
        "[ai] sending openai-compatible request provider={} model={} endpoint={}",
        settings.provider,
        resolved_model,
        endpoint
    );
    let mut request = build_http_client()?
        .post(endpoint)
        .header("content-type", "application/json");
    if !settings.api_key.trim().is_empty() {
        request = request.bearer_auth(&settings.api_key);
    }
    if settings.provider == "opencode" {
        request = request
            .header("User-Agent", "opencode/latest/1.3.15/cli")
            .header("x-opencode-client", "cli")
            .header("x-opencode-session", Uuid::new_v4().to_string())
            .header("x-opencode-project", Uuid::new_v4().to_string())
            .header("x-opencode-request", Uuid::new_v4().to_string().replace('-', ""));
    }

    let response = request
        .json(&request_body)
        .send()
        .await
        .map_err(|error| AppError::State(format!("AI request failed: {error}")))?;

    let status = response.status();
    eprintln!(
        "[ai] openai-compatible response provider={} model={} status={}",
        settings.provider,
        resolved_model,
        status
    );
    let response_text = read_openai_compatible_response_body(response).await?;
    eprintln!(
        "[ai] openai-compatible body preview {}",
        response_preview(&response_text, 280)
    );

    if !status.is_success() {
        return Err(AppError::State(format!(
            "AI provider returned {status}: {response_text}"
        )));
    }

    let response_json: serde_json::Value = serde_json::from_str(&response_text)
        .map_err(|error| AppError::State(format!("failed to parse AI JSON: {error}")))?;

    let raw_text = extract_openai_compatible_text(&response_json);

    let cleaned = if raw_text.starts_with("```") {
        raw_text
            .lines()
            .skip(1)
            .take_while(|line| !line.starts_with("```"))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        raw_text
    };

    if cleaned.trim().is_empty() {
        return Err(AppError::State(format!(
            "AI provider returned 200 OK but no textual output was extracted. Body preview: {}",
            response_preview(&response_text, 280)
        )));
    }

    serde_json::from_str(&cleaned).or_else(|_| {
        Ok(LearningAnalysisResult {
            knowledge_points: vec![],
            questions_for_user: vec![],
            suggested_memory_updates: vec![],
            summary: cleaned,
        })
    })
}

fn extract_openai_compatible_text(response_json: &serde_json::Value) -> String {
    if let Some(text) = response_json["response"].as_object().map(|_| {
        extract_openai_compatible_text(&response_json["response"])
    }).filter(|text| !text.trim().is_empty()) {
        return text;
    }

    if let Some(text) = response_json["data"].as_object().map(|_| {
        extract_openai_compatible_text(&response_json["data"])
    }).filter(|text| !text.trim().is_empty()) {
        return text;
    }

    if let Some(text) = response_json["output_text"].as_str() {
        return text.to_string();
    }

    if let Some(text) = response_json["output_text"].as_array().map(|parts| {
        parts
            .iter()
            .filter_map(|part| part.as_str().or_else(|| part["text"].as_str()))
            .collect::<Vec<_>>()
            .join("\n")
    }).filter(|text| !text.trim().is_empty()) {
        return text;
    }

    if let Some(text) = response_json["choices"]
        .as_array()
        .and_then(|choices| choices.first())
        .and_then(|choice| choice["message"]["content"].as_str())
    {
        return text.to_string();
    }

    if let Some(text) = response_json["choices"]
        .as_array()
        .and_then(|choices| choices.first())
        .and_then(|choice| choice["message"]["content"].as_array())
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| part["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n")
        })
    {
        return text;
    }

    response_json["output"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .flat_map(|item| item["content"].as_array().into_iter().flatten())
                .filter_map(|part| {
                    part["text"]
                        .as_str()
                        .or_else(|| part["output_text"].as_str())
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

fn response_preview(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }

    let preview: String = trimmed.chars().take(max_chars).collect();
    format!("{preview}...")
}

fn extract_sse_json_payload(stream_text: &str) -> Option<serde_json::Value> {
    let mut last_json: Option<serde_json::Value> = None;

    for line in stream_text.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("data:") {
            continue;
        }

        let data = trimmed.trim_start_matches("data:").trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }

        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
            if !extract_openai_compatible_text(&json).trim().is_empty() {
                return Some(json);
            }

            if json["response"].is_object() || json["output"].is_array() || json["choices"].is_array() {
                last_json = Some(json);
            }
        }
    }

    last_json
}

async fn read_openai_compatible_response_body(response: reqwest::Response) -> AppResult<String> {
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();

    if !content_type.contains("text/event-stream") {
        return response
            .text()
            .await
            .map_err(|error| AppError::State(format!("failed to read AI response: {error}")));
    }

    let mut response = response;
    let mut body = String::new();

    loop {
        let next_chunk = timeout(Duration::from_secs(15), response.chunk())
            .await
            .map_err(|_| AppError::State("timed out while waiting for streamed AI response body".into()))?;

        let chunk = next_chunk
            .map_err(|error| AppError::State(format!("failed to read streamed AI response: {error}")))?;

        let Some(chunk) = chunk else {
            break;
        };

        body.push_str(&String::from_utf8_lossy(&chunk));

        if body.contains("\n\ndata: [DONE]") || body.trim_end().ends_with("data: [DONE]") {
            break;
        }
    }

    if let Some(json) = extract_sse_json_payload(&body) {
        return serde_json::to_string(&json)
            .map_err(|error| AppError::State(format!("failed to serialize streamed AI payload: {error}")));
    }

    Ok(body)
}

fn build_openai_compatible_user_content(
    text: &str,
    attachments: &[Attachment],
    allow_images: bool,
) -> Vec<serde_json::Value> {
    let mut enriched_text = text.to_string();
    let attachment_ocr: Vec<&str> = attachments
        .iter()
        .filter_map(|attachment| {
            attachment
                .ocr_text
                .as_deref()
                .map(str::trim)
                .filter(|ocr| !ocr.is_empty())
        })
        .collect();

    if !attachment_ocr.is_empty() {
        enriched_text.push_str("\n\nAttachment OCR:\n");
        enriched_text.push_str(&attachment_ocr.join("\n\n---\n\n"));
    }

    let mut user_content: Vec<serde_json::Value> = vec![serde_json::json!({
        "type": "input_text",
        "text": format!("Please analyze this note for learning interaction preparation:\n\n{enriched_text}")
    })];

    if !allow_images {
        return user_content;
    }

    let image_attachment = attachments
        .iter()
        .find(|a| a.file_type == AttachmentType::Image || a.file_type == AttachmentType::Screenshot);
    if let Some(att) = image_attachment {
        let path = Path::new(&att.local_path);
        if path.exists() {
            if let Ok(bytes) = std::fs::read(path) {
                use base64::Engine;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                let media_type = match att.mime_type.as_str() {
                    "image/png" | "image/jpeg" | "image/webp" => att.mime_type.as_str(),
                    _ => "image/png",
                };
                user_content.push(serde_json::json!({
                    "type": "input_image",
                    "image_url": format!("data:{media_type};base64,{b64}")
                }));
            }
        }
    }

    user_content
}

fn build_openai_compatible_request_body(
    model: &str,
    system_prompt: &str,
    user_content: Vec<serde_json::Value>,
) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "stream": false,
        "input": [
            {
                "role": "system",
                "content": [
                    {
                        "type": "input_text",
                        "text": system_prompt
                    }
                ]
            },
            {
                "role": "user",
                "content": user_content
            }
        ]
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_ai_runtime_settings_prefers_new_key_and_falls_back_to_legacy() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory");
        db::run_migrations(&conn).expect("migrations");
        db::set_setting(&conn, "ai_provider", "claude").expect("provider");
        db::set_setting(&conn, "ai_model", "test-model").expect("model");
        db::set_setting(&conn, "claude_api_key", "legacy-key").expect("legacy key");

        let settings = load_ai_runtime_settings(&conn).expect("settings");
        assert_eq!(settings.provider, "claude");
        assert_eq!(settings.model, "test-model");
        assert_eq!(settings.api_key, "legacy-key");
    }

    #[test]
    fn load_ai_runtime_settings_allows_missing_key_when_base_url_is_configured() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory");
        db::run_migrations(&conn).expect("migrations");
        db::set_setting(&conn, "ai_provider", "claude").expect("provider");
        db::set_setting(&conn, "ai_model", "test-model").expect("model");
        db::set_setting(&conn, "ai_base_url", "http://127.0.0.1:3000/v1/messages")
            .expect("base url");

        let settings = load_ai_runtime_settings(&conn).expect("settings");
        assert_eq!(settings.base_url.as_deref(), Some("http://127.0.0.1:3000/v1/messages"));
        assert!(settings.api_key.is_empty(), "custom base_url should allow empty api key");
    }

    #[test]
    fn opencode_variant_resolves_to_zen_model_and_chat_completions_endpoint() {
        let settings = AiRuntimeSettings {
            provider: "opencode".into(),
            model: "".into(),
            model_variant: "deepseek-v4-flash-free".into(),
            api_key: "test-key".into(),
            base_url: Some("https://opencode.ai/zen/v1".into()),
        };

        assert_eq!(settings.resolved_model(), "deepseek-v4-flash-free");
        assert_eq!(settings.endpoint(), "https://opencode.ai/zen/v1/responses");
    }

    #[test]
    fn anthropic_endpoint_appends_messages_when_given_base_root() {
        let settings = AiRuntimeSettings {
            provider: "claude".into(),
            model: "claude-sonnet-4-20250514".into(),
            model_variant: "default".into(),
            api_key: "test-key".into(),
            base_url: Some("https://api.anthropic.com/v1".into()),
        };

        assert_eq!(settings.endpoint(), "https://api.anthropic.com/v1/messages");
    }

    #[test]
    fn opencode_explicit_model_strips_zen_prefix_before_request() {
        let settings = AiRuntimeSettings {
            provider: "opencode".into(),
            model: "zen:deepseek-v4-flash-free".into(),
            model_variant: "custom".into(),
            api_key: "test-key".into(),
            base_url: Some("https://opencode.ai/zen/v1".into()),
        };

        assert_eq!(settings.resolved_model(), "deepseek-v4-flash-free");
    }

    #[test]
    fn extract_openai_compatible_text_supports_responses_output_array() {
        let response_json = serde_json::json!({
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": "{\"summary\":\"done\"}"
                        }
                    ]
                }
            ]
        });

        assert_eq!(extract_openai_compatible_text(&response_json), "{\"summary\":\"done\"}");
    }

    #[test]
    fn extract_openai_compatible_text_supports_nested_response_wrapper() {
        let response_json = serde_json::json!({
            "response": {
                "output": [
                    {
                        "type": "message",
                        "content": [
                            {
                                "type": "output_text",
                                "text": "{\"summary\":\"wrapped\"}"
                            }
                        ]
                    }
                ]
            }
        });

        assert_eq!(
            extract_openai_compatible_text(&response_json),
            "{\"summary\":\"wrapped\"}"
        );
    }

    #[test]
    fn extract_sse_json_payload_supports_response_completed_event() {
        let stream_text = concat!(
            "event: response.output_text.delta\n",
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n",
            "event: response.completed\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"{\\\"summary\\\":\\\"done\\\"}\"}]}]}}\n\n",
            "data: [DONE]\n"
        );

        let payload = extract_sse_json_payload(stream_text).expect("payload");
        assert_eq!(
            extract_openai_compatible_text(&payload),
            "{\"summary\":\"done\"}"
        );
    }

    #[test]
    fn openai_compatible_user_content_can_fall_back_to_text_and_ocr_only() {
        let attachments = vec![Attachment {
            id: "att-1".into(),
            file_type: AttachmentType::Screenshot,
            mime_type: "image/png".into(),
            local_path: "C:\\missing-image.png".into(),
            thumbnail_path: None,
            ocr_text: Some("span decorator wraps function logic".into()),
            hash: "hash".into(),
            created_at: Utc::now(),
        }];

        let user_content = build_openai_compatible_user_content(
            "Title: Decorator note",
            &attachments,
            false,
        );

        assert_eq!(user_content.len(), 1);
        assert_eq!(user_content[0]["type"], "input_text");
        let text = user_content[0]["text"].as_str().expect("input text");
        assert!(text.contains("Title: Decorator note"));
        assert!(text.contains("Attachment OCR:"));
        assert!(text.contains("span decorator wraps function logic"));
        assert!(
            !text.contains("data:image"),
            "text fallback should avoid embedding image payloads for incompatible providers"
        );
    }

    #[test]
    fn openai_compatible_request_body_forces_non_streaming_mode() {
        let request_body = build_openai_compatible_request_body(
            "deepseek-v4-flash-free",
            "system prompt",
            vec![serde_json::json!({
                "type": "input_text",
                "text": "hello"
            })],
        );

        assert_eq!(request_body["model"], "deepseek-v4-flash-free");
        assert_eq!(request_body["stream"], false);
        assert_eq!(request_body["input"][0]["role"], "system");
        assert_eq!(request_body["input"][1]["role"], "user");
    }

    #[test]
    fn persist_learning_memory_updates_only_persists_candidate_topics() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory");
        db::run_migrations(&conn).expect("migrations");

        let record = db::insert_record(
            &conn,
            crate::models::CreateRecordRequest {
                record_type: Some(crate::models::RecordType::Note),
                title: Some("decorator note".into()),
                content: Some("span decorator".into()),
                source: crate::models::RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record");

        let result = LearningAnalysisResult {
            knowledge_points: vec![],
            questions_for_user: vec![],
            suggested_memory_updates: vec![crate::models::SuggestedMemoryUpdate {
                topic: "Python 装饰器".into(),
                mastery_level: "understanding".into(),
                evidence: "已能结合 span 装饰器理解监控场景中的用法".into(),
            }],
            summary: "summary".into(),
        };

        persist_learning_memory_updates(&conn, &record.id, &result).expect("persist");

        let topics = db::get_knowledge_topics_for_record(&conn, &record.id).expect("topics");
        assert_eq!(topics.len(), 1);
        assert_eq!(topics[0].name, "Python 装饰器");
        assert_eq!(
            topics[0].mastery_level,
            "candidate",
            "learning analysis must not mark confirmed understanding before dialog"
        );
        assert_eq!(topics[0].evidence_text, "已能结合 span 装饰器理解监控场景中的用法");
    }

    #[test]
    fn learning_analysis_ai_result_persists_full_research_payload() {
        let settings = AiRuntimeSettings {
            provider: "opencode".into(),
            model: "zen:deepseek-v4-flash-free".into(),
            model_variant: "deepseek-v4-flash-free".into(),
            api_key: "test-key".into(),
            base_url: Some("https://opencode.ai/zen/v1".into()),
        };

        let result = LearningAnalysisResult {
            knowledge_points: vec![crate::models::LearningKnowledgePoint {
                name: "Python 装饰器".into(),
                confidence: 0.92,
                example_from_note: "span 装饰器把埋点逻辑包在函数外层".into(),
            }],
            questions_for_user: vec!["你会如何把这个模式用到其他接口？".into()],
            suggested_memory_updates: vec![crate::models::SuggestedMemoryUpdate {
                topic: "Python 装饰器".into(),
                mastery_level: "candidate".into(),
                evidence: "笔记已经出现具体业务例子，适合后续对话确认".into(),
            }],
            summary: "记录了装饰器在应用监控中的一个真实用例。".into(),
        };
        let result_json = serde_json::to_string(&result).expect("serialize");

        let request = build_learning_analysis_ai_result_request(
            "record-1",
            &settings,
            &result,
            &result_json,
        );

        assert_eq!(request.record_id, "record-1");
        assert_eq!(
            request.research_result.as_deref(),
            Some(result_json.as_str()),
            "full learning analysis payload should be persisted for later card rehydration"
        );
        assert_eq!(
            request.summary.as_deref(),
            Some("记录了装饰器在应用监控中的一个真实用例。")
        );
    }

    #[test]
    fn learning_conversation_user_requested_memory_promotes_candidate_to_understanding() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory");
        db::run_migrations(&conn).expect("migrations");

        let record = db::insert_record(
            &conn,
            crate::models::CreateRecordRequest {
                record_type: Some(crate::models::RecordType::Note),
                title: Some("okr note".into()),
                content: Some("KR 交付形式".into()),
                source: crate::models::RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record");

        let topic = db::upsert_knowledge_topic(
            &conn,
            "OKR 执行理解",
            "候选知识，待确认",
            "candidate",
        )
        .expect("topic");

        let payload = crate::models::LearningConversationPayload {
            topic_id: topic.id.clone(),
            source_record_id: record.id.clone(),
            dialog_session_id: None,
            messages: vec![crate::models::LearningConversationMessage {
                role: "user".into(),
                content: "把这个知识写入记忆".into(),
            }],
            source_signals: vec!["user_requested_memory".into()],
        };

        let result = persist_learning_conversation(&conn, payload).expect("conversation");
        assert_eq!(result.decision, "promote_to_understanding");
        assert_eq!(
            db::get_knowledge_topic(&conn, &topic.id)
                .expect("updated topic")
                .mastery_level,
            "understanding"
        );
    }

    #[test]
    fn learning_conversation_restatement_promotes_candidate_to_understanding() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory");
        db::run_migrations(&conn).expect("migrations");

        let record = db::insert_record(
            &conn,
            crate::models::CreateRecordRequest {
                record_type: Some(crate::models::RecordType::Note),
                title: Some("decorator note".into()),
                content: Some("span decorator".into()),
                source: crate::models::RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record");

        let topic = db::upsert_knowledge_topic(
            &conn,
            "Python 装饰器",
            "候选知识，待确认",
            "candidate",
        )
        .expect("topic");

        let payload = crate::models::LearningConversationPayload {
            topic_id: topic.id.clone(),
            source_record_id: record.id.clone(),
            dialog_session_id: None,
            messages: vec![crate::models::LearningConversationMessage {
                role: "user".into(),
                content: "我能用自己的话解释 span 装饰器是在函数外面包一层逻辑。".into(),
            }],
            source_signals: vec!["restatement".into()],
        };

        let result = persist_learning_conversation(&conn, payload).expect("conversation");
        assert_eq!(result.decision, "promote_to_understanding");
        assert_eq!(
            db::get_knowledge_topic(&conn, &topic.id)
                .expect("updated topic")
                .mastery_level,
            "understanding"
        );
    }

    #[test]
    fn learning_conversation_application_promotes_candidate_to_understanding() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory");
        db::run_migrations(&conn).expect("migrations");

        let record = db::insert_record(
            &conn,
            crate::models::CreateRecordRequest {
                record_type: Some(crate::models::RecordType::Note),
                title: Some("monitoring note".into()),
                content: Some("trace span".into()),
                source: crate::models::RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record");

        let topic = db::upsert_knowledge_topic(
            &conn,
            "应用监控埋点",
            "候选知识，待确认",
            "candidate",
        )
        .expect("topic");

        let payload = crate::models::LearningConversationPayload {
            topic_id: topic.id.clone(),
            source_record_id: record.id.clone(),
            dialog_session_id: None,
            messages: vec![crate::models::LearningConversationMessage {
                role: "user".into(),
                content: "我能把这个思路用到别的接口埋点上。".into(),
            }],
            source_signals: vec!["application".into()],
        };

        let result = persist_learning_conversation(&conn, payload).expect("conversation");
        assert_eq!(result.decision, "promote_to_understanding");
        assert_eq!(
            db::get_knowledge_topic(&conn, &topic.id)
                .expect("updated topic")
                .mastery_level,
            "understanding"
        );
    }

    #[test]
    fn learning_conversation_not_knowledge_point_rejects_candidate() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory");
        db::run_migrations(&conn).expect("migrations");

        let record = db::insert_record(
            &conn,
            crate::models::CreateRecordRequest {
                record_type: Some(crate::models::RecordType::Note),
                title: Some("sync note".into()),
                content: Some("刷新疑问".into()),
                source: crate::models::RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record");

        let topic = db::upsert_knowledge_topic(
            &conn,
            "刷新疑问",
            "候选知识，待确认",
            "candidate",
        )
        .expect("topic");

        let payload = crate::models::LearningConversationPayload {
            topic_id: topic.id.clone(),
            source_record_id: record.id.clone(),
            dialog_session_id: None,
            messages: vec![crate::models::LearningConversationMessage {
                role: "user".into(),
                content: "这不是知识点，不要记录。".into(),
            }],
            source_signals: vec!["not_knowledge_point".into()],
        };

        let result = persist_learning_conversation(&conn, payload).expect("conversation");
        assert_eq!(result.decision, "reject_candidate");
        assert!(result.memory_write.is_none());
        assert_eq!(
            db::get_knowledge_topic(&conn, &topic.id)
                .expect("updated topic")
                .mastery_level,
            "rejected"
        );
    }
}
