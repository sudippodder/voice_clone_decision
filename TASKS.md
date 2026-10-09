# Executive Voice Agent — Project Task List & Roadmap

An actionable task breakdown and phased roadmap for **ExecutiveMind AI (voice_clone_decision)**.

---

## 📊 Project Status Overview

| Phase | Focus Area | Status | Progress |
| :--- | :--- | :---: | :---: |
| **Phase 1** | Foundation Architecture & Multi-Client Framework | **COMPLETED** | 100% |
| **Phase 2** | Voice Cloning & Voice ID Library Integration | **COMPLETED** | 100% |
| **Phase 3** | Access Control & Executive Profile Ingestion | **COMPLETED** | 100% |
| **Phase 4** | Real-Time Latency & Full-Duplex Voice Engine | **PLANNED** | 15% |
| **Phase 5** | RAG Knowledge Base & Document Context | **PLANNED** | 0% |
| **Phase 6** | Telephony Integration & External Channels (Twilio/SIP) | **PLANNED** | 0% |
| **Phase 7** | Governance, Consent Auditing & Safety Railguards | **PLANNED** | 20% |
| **Phase 8** | Production Hardening, CI/CD & Cloud Deployment | **PLANNED** | 10% |

---

## ✅ Completed Milestones

### 1. Multi-Client & Architecture Foundation
- [x] **Client Management CRUD**: Full client lifecycle management (Add, Edit details, Toggle Active status, Soft/Hard Delete with cascading cleanup).
- [x] **Modular Next.js + Tailwind UI**: Tabbed navigation between Executive Clients and Voice Registry.
- [x] **FastAPI Backend Core**: SQLAlchemy database models (`Client`, `ExecutiveProfile`, `Memory`, `Conversation`, `Message`) on PostgreSQL.
- [x] **Git Repository & Security**: Comprehensive `.gitignore` protecting all `.env`, `.venv`, and audio files. Connected to remote repo `voice_clone_decision`.

### 2. Voice Twin Studio & Cloning Pipeline
- [x] **ElevenLabs Instant Voice Cloning**: File upload handler (`/v1/voices/add`) with audio validation and instant ID binding.
- [x] **Library Voice Cloning Action**: Direct cloning capability from the central "Voice IDs & Clones Library" tab.
- [x] **Audio In-Browser Preview**: Real-time audio player to preview voice samples before and after cloning.
- [x] **Bi-Directional Voice Rename**: Renaming clones in the UI updates PostgreSQL and syncs directly to ElevenLabs via API (`/v1/voices/{voice_id}/edit`).
- [x] **OpenAI Neural Fallback**: 9 pre-configured OpenAI TTS personas (`onyx`, `alloy`, `echo`, `nova`, `ash`, etc.).

### 3. Access Control & Decision Intelligence (Shaun Profile)
- [x] **Full-Section Login Protection**: Entire application locked behind authentication gate (`virtualemployee` / `virtual@1234`).
- [x] **Session Persistence**: Encrypted session storage in `localStorage` with header status badge and 1-click logout.
- [x] **Decision Intelligence Profile Ingestion**: Populated Shaun's executive profile from transcript (`help.txt`):
  - Cognitive load minimization heuristic
  - Office photography legitimacy standard
  - 3-pillar copywriting framework (200+ experts, 1-week trial, start tomorrow)
  - Timezone localization rule (always client local time; no IST exposure)
  - Hiring triad workflow (Interview vs Trial vs Direct Task Assignment)
- [x] **Verified Memory Bank**: Added 6 structured memories reflecting core operational principles.

---

## 🚀 Upcoming Roadmap & Actionable Tasks

### 🎙️ Phase 4: Low-Latency & Streaming Voice Engine
> **Goal**: Transition from turn-based request/response audio generation to fluid, low-latency, conversational voice streaming (<800ms response time).

- [ ] **Streaming TTS Integration**:
  - [ ] Implement ElevenLabs WebSocket streaming API (`wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input`).
  - [ ] Chunk LLM text output into natural sentences and stream directly into TTS without waiting for complete LLM generation.
- [ ] **Client-Side Audio Streaming**:
  - [ ] Implement Web Audio API audio chunk queueing to play incoming audio streams seamlessly.
  - [ ] Implement Speech-to-Text streaming (OpenAI Realtime API or Deepgram Nova-2) for live transcription.
- [ ] **Interruption Handling (Barge-In)**:
  - [ ] Detect user speech during AI playback (VAD - Voice Activity Detection).
  - [ ] Immediately cancel active TTS playback and LLM stream when the user begins speaking.

---

### 📚 Phase 5: RAG & Document Knowledge Base
> **Goal**: Allow executives to upload company documents, pitch decks, FAQs, and Slack exports to ground the AI agent in deep factual context.

- [ ] **Document Ingestion Engine**:
  - [ ] Support PDF, DOCX, TXT, and Markdown file uploads per client.
  - [ ] Text chunking and cleaning with metadata tagging.
- [ ] **Vector Database & Embeddings**:
  - [ ] Integrate pgvector (in PostgreSQL) or Qdrant/Chroma.
  - [ ] Generate embeddings using `text-embedding-3-small`.
- [ ] **Semantic Retrieval in System Prompt**:
  - [ ] Query vector store during user turns and inject relevant document snippets into the prompt dynamically.
  - [ ] Source attribution: Have the agent cite document sources or section titles when providing data.

---

### 📞 Phase 6: Telephony & Multi-Channel Presence
> **Goal**: Enable inbound and outbound phone calls and messaging channels where the AI represents the executive.

- [ ] **Telephony Integration (Twilio / LiveKit / SIP)**:
  - [ ] Twilio Voice Webhook integration for incoming telephone calls to a dedicated executive phone number.
  - [ ] Bidirectional audio streaming bridge connecting Twilio Media Streams to the voice agent engine.
- [ ] **Call Recording & Summarization**:
  - [ ] Automatic recording and transcription of incoming calls.
  - [ ] Post-call executive briefing generation (Bullet points, Action items, Commitments made).
  - [ ] Automated email/SMS briefing sent to the real executive after each call.
- [ ] **WhatsApp / Slack Voice Note Bot**:
  - [ ] Integration to receive voice notes via WhatsApp Business API or Slack.
  - [ ] Generate responses using the executive's cloned voice and send back as audio messages.

---

### 🛡️ Phase 7: Governance, Safety Railguards & Approvals
> **Goal**: Enterprise-grade compliance, auditability, and guardrails to prevent hallucinated commitments or prompt injections.

- [ ] **Human-in-the-Loop (HITL) Escalation**:
  - [ ] Confidence scoring on AI answers.
  - [ ] Automatic escalation flag for sensitive commitments (pricing, legal contracts, hiring/firing).
  - [ ] "Pending Approval" queue where executive reviews and approves draft commitments before sending.
- [ ] **Prompt Injection Defense**:
  - [ ] Input sanitization layer to prevent jailbreaks, prompt leaks, or overriding executive instructions.
  - [ ] Output verification filter to ensure AI does not claim to be the human physical person.
- [ ] **Biometric & Consent Audit Logging**:
  - [ ] Immutable audit table recording timestamped voice consent authorizations.
  - [ ] Client voice sample retention and "Right to be Forgotten" deletion pipelines.

---

### 🚢 Phase 8: Production Hardening, CI/CD & Cloud Deployment
> **Goal**: Scalable, containerized deployment ready for high concurrency.

- [ ] **Storage Migration**:
  - [ ] Move local `uploads/` directory to AWS S3 / Cloudflare R2 bucket with signed URLs.
- [ ] **Redis Caching & Session Management**:
  - [ ] Cache voice lists, client profiles, and conversation states in Redis.
  - [ ] Rate-limiting middleware per IP/Account.
- [ ] **CI/CD Pipeline**:
  - [ ] GitHub Actions workflow for linting, TypeScript build verification, and Python test suites.
  - [ ] Automated Docker image build and deployment to cloud (AWS ECS, DigitalOcean, or Render).
- [ ] **Telemetry & Monitoring**:
  - [ ] Sentry error monitoring integration for both frontend and backend.
  - [ ] LangSmith / OpenTelemetry tracing for LLM latency, token usage, and cost tracking.

---

## 📌 Recommended Next Sprint Priorities

1. **Sprint 1 (Immediate Next Step)**: **Phase 4 - Streaming Voice Engine**.
   - Reduces response latency from ~3-4s to <1s for conversation realism.
2. **Sprint 2**: **Phase 5 - Document Uploads (RAG)**.
   - Enables uploading executive playbooks, FAQs, and company guidelines.
3. **Sprint 3**: **Phase 6 - Inbound Phone Line (Twilio)**.
   - Allows live phone calls to Shaun's voice agent over cellular networks.
