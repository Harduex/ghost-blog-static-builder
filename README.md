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
npm run build   # Build static site (skips deployment)
npm run preview # Build and preview locally at http://localhost:8080
npm run deploy  # Build static site and push to GitHub Pages
```

## HTML Element Cleanup

The build pipeline can automatically remove unwanted HTML elements from your static output. This is useful for stripping:
- Navigation elements that don't make sense in static builds
- Dynamic features like signup forms or comments
- Ghost-specific scripts and overlays
- Custom UI elements you don't want in the static version

### Configuration

Edit the `elementsToRemove` array in `deploy.js`:

```javascript
const elementsToRemove = [
    '.gh-head-actions',           // Simple class selector
    '#ghost-portal-root',         // ID selector
    '.subscribe-overlay',         // Another class
    'div.modal.is-active',        // Combined selectors
    'body > div > header > nav'    // Complex descendant selector
];
```

### Finding CSS Selectors in Your Browser

You don't need to write selectors manually. All modern browsers (Chrome, Firefox, Edge, Safari) have built-in tools to copy element selectors:

#### Steps for Chrome/Edge/Firefox:

1. **Right-click** on the element in the website you want to remove (e.g., a header, button, or overlay)
2. Select **Inspect** (or "Inspect Element")
3. The DevTools panel will open with the HTML code, and the element will be highlighted in blue
4. **Right-click** on the highlighted HTML element in the DevTools panel
5. Go to **Copy** → **Copy selector** (or "Copy CSS Selector" in some browsers)
6. Paste the selector into the `elementsToRemove` array in `deploy.js`

#### Example:

If you want to remove a dropdown menu that appears on hover, you'd:
1. Hover over the element and right-click it
2. Select **Inspect** to open DevTools
3. In the DevTools panel, **right-click** on the highlighted HTML element
4. Select **Copy** → **Copy selector**
5. Paste the selector into the `elementsToRemove` array in `deploy.js`:

```javascript
const elementsToRemove = [
    'body > div.site-wrapper > header > div > ul > li.dropdown.is-right.is-hoverable.hidden.relative.lg\\:block > div > div > div'
];
```

**Note on escaping:** If a selector contains special characters inside class names (e.g., Tailwind `lg:flex`), CSS requires escaping the colon as `\:`. Inside a JavaScript string you must escape that backslash, so write it as `lg\\:flex`.

Example:

- DevTools copies: `li.header-dropdown-menu.hidden.lg:flex.items-center`
- In `elementsToRemove`: `'li.header-dropdown-menu.hidden.lg\\:flex.items-center'`

## Migrating an Existing Ghost Instance

If you have an existing Ghost blog, you can migrate it to this setup:

### 1. Export from Existing Ghost

1. Log into your existing Ghost admin panel (`/ghost`)
2. Navigate to **Settings → Advanced → Import/Export**
3. Click **Export your content** and download the JSON file

### 2. Copy Content Directory

Copy your existing Ghost content directory to preserve images, themes, and files:

```bash
# From your existing Ghost installation
cp -r /path/to/existing/ghost/content/* ./ghost/content/
```

This preserves:
- Images (`content/images/`)
- Themes (`content/themes/`)
- Custom files (`content/files/`)
- Media uploads (`content/media/`)

### 3. Import into New Instance

1. Start the local Ghost instance: `npm run start`
2. Access Ghost admin at `http://localhost:2368/ghost`
3. Complete the initial setup if it's a fresh installation
4. Navigate to **Settings → Advanced → Import/Export**
5. Under **Import**, click **Universal Import**
6. Upload the exported JSON file from step 1
7. Click **Import** to restore all posts, pages, tags, and settings

### 4. Verify Migration

- Check that all posts and pages appear correctly
- Verify images are loading (they should reference the copied content directory)
- Review theme settings and customizations
- Test internal links and navigation

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
