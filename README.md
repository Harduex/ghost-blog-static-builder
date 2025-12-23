# Ghost Blog Static Builder

A production-grade deployment pipeline for converting Ghost CMS into a static site hosted on GitHub Pages.

## Overview

This toolchain runs a local Ghost instance with MySQL, generates a static snapshot of your blog, and deploys it to GitHub Pages. It handles asset scraping, URL rewriting, and content sanitization automatically.

## Prerequisites

- Docker & Docker Compose
- Node.js (v16+)
- `wget` (installed by default on most Unix systems)
- Git repository configured with `gh-pages` branch

## Quick Start

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env with your settings

# 2. Start Ghost locally
npm run start

# 3. Create content at http://localhost:2368/ghost

# 4. Deploy to production
npm run deploy
```

## Architecture

```
┌─────────────┐      ┌──────────────┐      ┌────────────────┐
│   Ghost     │─────▶│  deploy.js   │─────▶│ GitHub Pages   │
│  + MySQL    │      │  (Builder)   │      │  (Static CDN)  │
└─────────────┘      └──────────────┘      └────────────────┘
   Docker              Node Pipeline          gh-pages branch
```

### Components

**Ghost Container** (`ghost:5-alpine`)  
Production Ghost instance with persistent content and database volumes.

**MySQL Container** (`mysql:8.0`)  
Relational database with health checks and automatic retries.

**Build Pipeline** (`deploy.js`)  
Orchestrates mirroring, asset auditing, content sanitization, and GitHub deployment.

## Configuration

Environment variables in `.env`:

| Variable | Description | Example |
|----------|-------------|---------|
| `GHOST_URL` | Local Ghost instance | `http://localhost:2368` |
| `DEPLOY_URL` | Production domain | `https://blog.example.com` |
| `DB_NAME` | MySQL database name | `ghost` |
| `DB_USER` | MySQL username | `ghost` |
| `DB_PASSWORD` | MySQL user password | `ghostdbpass` |
| `DB_ROOT_PASSWORD` | MySQL root password | `somesecretrootpass` |

## Commands

```bash
npm run start   # Start Ghost + MySQL (detached)
npm run stop    # Stop all containers
npm run deploy  # Build static site and push to GitHub Pages
```

## Data Persistence

All data persists in local volumes:

```
./ghost/content/      # Images, themes, configs
./ghost/mysql-data/   # Database files
```

Backups are stored as timestamped exports in `./ghost/content/data/`.

## Production Considerations

- **Custom Domain**: Configure DNS with a `CNAME` record pointing to `<username>.github.io`
- **HTTPS**: Enabled automatically via GitHub Pages (requires custom domain)
- **CDN**: Content is served through GitHub's global CDN
- **Cache Busting**: Query parameters are normalized during build
- **Ghost Portal**: Stripped from static output
