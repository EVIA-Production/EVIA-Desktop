# EVIA Frontend
React + Vite + TypeScript frontend for EVIA.

## Project info

**Live App**: https://frontend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io/

## How can I edit this code?

There are several ways of editing your application.

You can edit locally in any IDE. Ensure Node 20+ is installed.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
git clone <YOUR_GIT_URL>
cd evia-frontend
npm i
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with Vite, React, TypeScript, shadcn/ui, Tailwind CSS, TanStack Query.

## Features
- Auth (login/register), protected admin routes
- Chats: list/create/rename/delete; live transcription; suggestions
- Admin dashboards: overall and per-user metrics via backend `/admin/metrics` and `/admin/users/{username}/metrics`

## Configuration
Set at build-time via Vite args/env:
- `VITE_BACKEND_URL=https://backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io`
- `VITE_BACKEND_PORT=443` (optional; auto-handled if URL includes scheme and host)

## Deployment
- CI/CD with GitHub Actions builds Docker image and updates Azure Container Apps on push to `main`.

## Troubleshooting
- If “Failed to fetch” on protected APIs, verify you’re logged in and CORS allows the frontend host.
- WebSocket issues: ensure token and `chatId` are set, and backend WS endpoint is reachable (wss on prod).
