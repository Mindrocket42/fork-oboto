# Contributing to Oboto

First off, thanks for taking the time to contribute! Oboto is an ambitious project to build an AI assistant with a persistent "inner life," and we need your help to make it better.

## 🏗️ Structured Development

Oboto uses a **Structured Development** process to maintain architectural integrity. Before you write code, please understand how we use the `SYSTEM_MAP.md`.

1.  **The Manifest is Truth:** The `SYSTEM_MAP.md` file in the root directory is the source of truth for the system's architecture, features, and invariants.
2.  **Read Before You Write:** Before starting a feature, check the manifest to see where it fits.
3.  **Update the Map:** If you add a new feature or change an existing one, you **must** update the `SYSTEM_MAP.md` to reflect the changes. This ensures the AI (and other humans) always have an accurate mental model of the codebase.

## 🛠️ How to Contribute

### 1. Reporting Bugs
-   Check the [Issues](https://github.com/sschepis/oboto/issues) to see if it's already reported.
-   Open a new issue with a clear title and description.
-   Include steps to reproduce and (if possible) screenshots.

### 2. Suggesting Features
-   Open a Discussion or Issue.
-   Explain *why* this feature is useful.
-   Describe how it fits into the "Consciousness" or "Multi-Agent" architecture.

### 3. Pull Requests
1.  **Fork the repo** and create your branch from `main`.
2.  **Install dependencies:**
    ```bash
    npm install
    cd ui && pnpm install
    ```
3.  **Run the dev environment:**
    ```bash
    # Backend
    npm run start:server
    # Frontend (in another terminal)
    npm run dev:ui
    ```
4.  **Make your changes.**
5.  **Update `SYSTEM_MAP.md`** if you changed architecture.
6.  **Run tests:** `npm test`
7.  **Submit a Pull Request.**

## 🧩 Developing Plugins

Oboto is designed to be extensible. Check out `plugins/hello-world` for a simple example of how to build a plugin.

Plugins can:
-   Register new **Tools**.
-   Add **Surfaces** (UI components).
-   Hook into the **Agent Loop**.

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.
