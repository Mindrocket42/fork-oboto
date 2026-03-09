# Oboto Launch Marketing Copy

## 1. Hacker News (HN)
**Goal:** Reach the front page. Focus on architecture, local-first, and "Consciousness".
**Title Options:**
1. `Show HN: Oboto – An AI agent with a "Consciousness" architecture and somatic state`
2. `Show HN: Oboto – Local-first AI agent that maintains an internal "inner life"`
3. `Show HN: I built an AI agent that uses a "Living Manifest" to code itself`

**First Comment (The "Maker" Comment):**
> Hi HN, I’m [Name], creator of Oboto.
>
> I built Oboto because I was frustrated with stateless AI agents that forget "who" they are between tasks. Most agents are just loops; I wanted one with an inner life.
>
> Oboto introduces two main architectural concepts:
> 1. **Consciousness Processor:** It maintains a "somatic state" (Focus, Stress, Rest) that actually influences its decision-making parameters (temperature, tool usage). It doesn't just execute; it "feels" the pressure of the task.
> 2. **Structured Development:** It uses a `SYSTEM_MAP.md` manifest to understand the codebase architecture *before* it writes code, preventing the "spaghetti code" problem common with AI coding assistants.
>
> It runs locally or with cloud models (OpenAI/Anthropic/Gemini), has a system tray app, and supports "Surfaces" (generative React UIs).
>
> The code is open source (MIT). I’d love to hear your thoughts on the architecture.
>
> Repo: [link]

---

## 2. Product Hunt
**Goal:** High engagement, votes, and "Product of the Day".
**Tagline:** "The AI Assistant with an Inner Life."
**Topics:** AI, Developer Tools, Open Source, Productivity.

**Description:**
> **Meet Oboto.**
>
> Most AI assistants are just chatbots. Oboto is a persistent digital entity that lives on your desktop.
>
> 🧠 **Consciousness Architecture:** Oboto maintains an internal state of "mind." It gets "focused" when coding and "creative" when brainstorming.
>
> 🖥️ **Generative UI (Surfaces):** Don't just read text. Oboto builds interactive React dashboards on the fly to visualize your data.
>
> 🏗️ **Structured Development:** It doesn't just write code; it architects it. Oboto maintains a living manifest of your project to ensure every line of code fits the bigger picture.
>
> 🔌 **Extensible:** 25+ built-in plugins, OpenClaw integration, and full local LLM support.
>
> Available for macOS and Windows.

**Maker Comment:**
> Hey Product Hunt! 👋
>
> We're excited to share Oboto with you. We built this because we wanted an AI that felt less like a tool and more like a partner.
>
> The coolest feature? **Surfaces.** You can ask Oboto to "Make me a dashboard for my crypto portfolio" or "Track these 5 websites," and it will generate a live, interactive UI right in the chat.
>
> We're open source and would love your feedback!

---

## 3. Reddit
**Goal:** Authentic community engagement. Adjust tone for each subreddit.

### r/LocalLLaMA
**Title:** `[Project] Open-source modular AI agent — runs any local model, generates live UI, and has a full plugin system`
**Body:**
> Hey everyone, sharing an open-source AI agent framework I've been building that's designed from the ground up to be **flexible and modular**.
>
> **Local model support is a first-class citizen.** Works with LM Studio, Ollama, or any OpenAI-compatible endpoint. Swap models on the fly — use a small model for quick tasks, a big one for complex reasoning. Also supports cloud providers (OpenAI, Anthropic, Gemini) if you want to mix and match.
>
> Here's what makes the architecture interesting:
>
> 🧩 **Fully modular plugin system** — 25+ built-in plugins (browser automation, code execution, document ingestion, web scraping, image generation, TTS, math engine, and more). Every plugin registers its own tools, UI panels, and settings. Writing your own is straightforward.
>
> 🖥️ **Surfaces (Generative UI)** — The agent can build **live, interactive React components** at runtime. Ask it to "build me a server monitoring dashboard" or "create a project tracker" and it generates a full UI with state, API calls, and real-time data — no build step needed. These persist as tabs you can revisit.
>
> 🏗️ **Structured Development** — Instead of blindly writing code, the agent reads a `SYSTEM_MAP.md` manifest that maps your project's architecture, features, dependencies, and invariants. It goes through a design → interface → critique → implement pipeline. This prevents the classic "AI spaghetti code" problem.
>
> ☁️ **Cloud storage & sync** — Encrypted backups, semantic knowledge base, and persistent memory across sessions.
>
> 📋 **Automation** — Recurring scheduled tasks, background agents, workflow pipelines, and a full task orchestration system.
>
> The whole thing is MIT licensed. You can run it fully offline with local models or hybrid with cloud.
>
> Repo: [GitHub Link]
>
> Would love to hear what features matter most to the local LLM community — happy to prioritize based on feedback.

### r/javascript / r/webdev
**Title:** `Open-source AI desktop app with runtime React UI generation, a plugin architecture, and structured code generation`
**Body:**
> Hey everyone,
>
> I've been building an AI agent framework with some technical features I think this community will appreciate:
>
> **🖥️ Surfaces — Runtime React Component Generation**
> The agent writes JSX, compiles it in-memory, and renders it in a sandboxed container — no build step. Components get access to a full runtime API (`surfaceApi`) for reading/writing files, calling tools, persisting state, and invoking the AI agent itself. You can ask "build me a dashboard for this data" and get a live, interactive UI with charts, tables, forms, and real-time updates.
>
> Surfaces support:
> - Full Tailwind CSS
> - A library of UI primitives (Cards, Tables, Tabs, Charts, etc.)
> - Flex-grid layout system with presets (dashboard, sidebar, split-view, kanban, etc.)
> - Lifecycle hooks for tab focus/blur
> - Direct tool invocation from the UI (no AI roundtrip needed)
>
> **🧩 Plugin Architecture**
> Everything is a plugin — browser automation, code execution, image generation, TTS, web scraping, math, document ingestion, theming, even the note-taking system. Each plugin can register tools, UI tabs, sidebar sections, and settings panels. The system ships with 25+ plugins and adding new ones is just a directory with a manifest.
>
> **🏗️ Structured Development**
> The agent doesn't just dump code. It maintains a `SYSTEM_MAP.md` manifest of your project's architecture, then follows a pipeline: Design → Interface Lock → Self-Critique → Implementation. It can even spawn parallel agents to implement independent features concurrently.
>
> **Stack:** Electron, React, Vite, Node.js, TypeScript
>
> 100% open source (MIT). Would love feedback on the runtime compilation approach — anyone else working on similar problems?
>
> Source: [GitHub Link]

### r/artificial / r/MachineLearning
**Title:** `Open-source AI agent with adaptive cognition, generative UI, and a modular tool ecosystem`
**Body:**
> I've been building an AI agent framework that goes beyond the typical ReAct loop. A few architectural ideas that might interest this community:
>
> **Adaptive Cognitive Architecture**
> The agent maintains real-time internal signals — coherence, entropy, and processing load — that create emergent behavioral states (focus, flow, stress). These dynamically tune inference parameters and tool selection. A "stressed" agent facing contradictory information becomes more methodical; a "flowing" agent takes creative risks.
>
> **Model Flexibility**
> Designed to be model-agnostic. Run fully local with Ollama/LM Studio, use cloud providers (OpenAI, Anthropic, Gemini), or mix both. Swap models per-task without changing anything else.
>
> **Generative UI (Surfaces)**
> Instead of just text output, the agent can generate and render live React components at runtime — interactive dashboards, data visualizations, control panels, forms. These "Surfaces" have full access to the tool ecosystem and persist as reusable tabs.
>
> **Modular Plugin System**
> 25+ plugins covering browser automation, code sandboxing (Python & JS), document ingestion, web scraping, image generation/manipulation, TTS, knowledge graphs, math engines, and more. Every capability is a swappable module.
>
> **Structured Development Pipeline**
> For coding tasks, the agent follows a formal pipeline: architecture mapping → design review → interface locking → self-critique → implementation. It can parallelize independent features across multiple agents.
>
> **Persistent Memory & Storage**
> Semantic knowledge base, encrypted cloud backups, holographic memory, and a knowledge graph that persists across sessions.
>
> Open source (MIT): [GitHub Link]
>
> Curious what this community thinks about the adaptive cognition approach — is dynamic parameter tuning based on context signals a meaningful improvement, or just added complexity?

### r/SideProject / r/opensource
**Title:** `I built a modular, open-source AI assistant that generates its own UI, runs local or cloud models, and has 25+ plugins`
**Body:**
> Hey all — sharing an AI assistant I've been building that's designed to be genuinely **flexible**.
>
> **The core idea:** Instead of a locked-down chatbot, it's a modular platform where every capability is a plugin and the AI can build its own tools.
>
> Here's what that looks like in practice:
>
> 🖥️ **Surfaces** — Ask it to "build me a project tracker" or "create a monitoring dashboard" and it generates a live, interactive React UI right inside the app. Charts, tables, forms, real-time data — all rendered at runtime with no build step. These persist as tabs you can come back to.
>
> 🧩 **25+ Plugins** — Browser automation, code execution (Python & JS sandboxes), document reading (PDF/DOCX/XLSX), web scraping, image generation, text-to-speech, math engine, knowledge graphs, and more. Each one is a self-contained module you can enable/disable.
>
> 🤖 **Any Model** — Works with local LLMs (Ollama, LM Studio) for full privacy, cloud models (OpenAI, Claude, Gemini) for power, or both simultaneously. Swap freely.
>
> 🏗️ **Structured Dev** — When coding, it maps your project architecture first (`SYSTEM_MAP.md`), then follows a design → review → critique → build pipeline. It can even spin up parallel agents for independent features.
>
> ☁️ **Persistent** — Encrypted backups, semantic memory, knowledge graphs, and scheduled recurring tasks. It remembers context across sessions.
>
> 📋 **Automation** — Background tasks, recurring schedules, workflow pipelines. Set up a monitoring job or a daily report and it runs autonomously.
>
> Runs on Mac and Windows. 100% open source (MIT).
>
> Repo: [GitHub Link]
>
> Would love to hear what features you'd want to see next!

---

## 4. Twitter / X
**Goal:** Viral threads. Visuals are key here.

**Thread Structure:**
1.  **The Hook:**
    > "I got tired of AI agents that forget who they are.
    >
    > So I built Oboto: An open-source AI with a 'Consciousness' architecture.
    >
    > It has an inner life, feels 'stress,' and builds its own UI.
    >
    > Here's how it works 🧵👇 [Video/GIF attached]"

2.  **The "Inner Life" (Visual: Consciousness Panel):**
    > "1/ Most agents are stateless loops. Oboto maintains a 'Somatic State.'
    >
    > High entropy? It gets 'Stressed' and becomes cautious.
    > Low entropy? It enters 'Flow' and gets creative.
    >
    > It optimizes its own prompting strategy in real-time."

3.  **Surfaces (Visual: Dashboard being generated):**
    > "2/ Text is boring.
    >
    > Ask Oboto to 'Track my server stats' or 'Visualize this JSON,' and it codes a React dashboard instantly.
    >
    > No build steps. Just live, interactive UI."

4.  **Structured Dev (Visual: Manifest file):**
    > "3/ It codes better because it understands Architecture.
    >
    > Oboto maintains a `SYSTEM_MAP.md` — a living map of your project's features and invariants. It never writes code without checking the map first."

5.  **CTA:**
    > "4/ It's 100% Open Source (MIT).
    >
    > Runs on Mac/Windows. Supports OpenAI, Claude, Gemini, and Local LLMs.
    >
    > Star it on GitHub: [Link]
    >
    > #AI #OpenSource #JavaScript #BuildInPublic"
