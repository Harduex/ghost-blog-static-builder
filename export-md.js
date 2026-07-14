// export-md.js — Export Ghost blog posts to Markdown files
require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');

// --- Configuration ---
const CONFIG = {
    ghostDataDir: path.resolve(__dirname, 'ghost/content/data'),
    exportDir: path.resolve(__dirname, 'export'),
    ghostUrl: process.env.GHOST_URL || 'http://localhost:2368',
    deployUrl: process.env.DEPLOY_URL || '',
    db: {
        host: '127.0.0.1',
        port: Number(process.env.DB_PORT) || 13928,
        user: process.env.DB_USER || 'ghost',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'ghost',
    },
};

// --- Turndown Setup ---
const createTurndownService = () => {
    const turndown = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
        emDelimiter: '*',
        strongDelimiter: '**',
        hr: '---',
    });

    // Enable GitHub Flavored Markdown (tables, strikethrough, task lists)
    turndown.use(gfm);

    // Custom rule: preserve figure/figcaption as image + italic caption
    turndown.addRule('figure', {
        filter: 'figure',
        replacement: (content, node) => {
            const img = node.querySelector('img');
            const figcaption = node.querySelector('figcaption');
            if (!img) return content;

            const src = img.getAttribute('src') || '';
            const alt = img.getAttribute('alt') || figcaption?.textContent || '';
            const caption = figcaption ? `\n*${figcaption.textContent.trim()}*` : '';
            return `\n\n![${alt}](${src})${caption}\n\n`;
        },
    });

    // Custom rule: Ghost bookmark cards → titled links
    turndown.addRule('ghostBookmark', {
        filter: (node) => {
            return node.nodeName === 'FIGURE' &&
                node.className && node.className.includes('kg-bookmark-card');
        },
        replacement: (content, node) => {
            const link = node.querySelector('a.kg-bookmark-container');
            const title = node.querySelector('.kg-bookmark-title');
            if (!link) return content;

            const href = link.getAttribute('href') || '';
            const text = title ? title.textContent.trim() : href;
            return `\n\n[${text}](${href})\n\n`;
        },
    });

    // Custom rule: Ghost callout/aside cards
    turndown.addRule('ghostCallout', {
        filter: (node) => {
            return node.nodeName === 'DIV' &&
                node.className && node.className.includes('kg-callout-card');
        },
        replacement: (content, node) => {
            const emoji = node.querySelector('.kg-callout-emoji');
            const text = node.querySelector('.kg-callout-text');
            if (!text) return content;

            const prefix = emoji ? `${emoji.textContent.trim()} ` : '> ';
            return `\n\n> ${prefix}${text.textContent.trim()}\n\n`;
        },
    });

    return turndown;
};

// --- Helpers ---

/**
 * Find the latest Ghost JSON export file by filename timestamp.
 */
const findLatestExport = (dataDir) => {
    if (!fs.existsSync(dataDir)) {
        return null;
    }

    const files = fs.readdirSync(dataDir)
        .filter(f => f.endsWith('.json') && f.includes('ghost'))
        .sort();

    return files.length > 0 ? path.join(dataDir, files[files.length - 1]) : null;
};

/**
 * Build lookup maps for tags and authors from the Ghost export data.
 */
const buildLookups = (data) => {
    // Tag lookup: id → tag object
    const tagsById = new Map();
    for (const tag of data.tags || []) {
        tagsById.set(tag.id, tag);
    }

    // User lookup: id → user object
    const usersById = new Map();
    for (const user of data.users || []) {
        usersById.set(user.id, user);
    }

    // Post → tags mapping: post_id → [tag names] (sorted by sort_order)
    const postTags = new Map();
    const sortedPostsTags = [...(data.posts_tags || [])].sort((a, b) => a.sort_order - b.sort_order);
    for (const pt of sortedPostsTags) {
        const tag = tagsById.get(pt.tag_id);
        // Skip internal tags (names starting with #)
        if (!tag || tag.visibility === 'internal') continue;

        if (!postTags.has(pt.post_id)) postTags.set(pt.post_id, []);
        postTags.get(pt.post_id).push(tag.name);
    }

    // Post → authors mapping: post_id → [author names] (sorted by sort_order)
    const postAuthors = new Map();
    const sortedPostsAuthors = [...(data.posts_authors || [])].sort((a, b) => a.sort_order - b.sort_order);
    for (const pa of sortedPostsAuthors) {
        const user = usersById.get(pa.author_id);
        if (!user) continue;

        if (!postAuthors.has(pa.post_id)) postAuthors.set(pa.post_id, []);
        postAuthors.get(pa.post_id).push(user.name);
    }

    return { postTags, postAuthors };
};

/**
 * Escape a YAML string value — wrap in quotes if it contains special chars.
 */
const yamlValue = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val);
    if (str === '') return '""';
    // Quote if it contains YAML-special characters
    if (/[:#\[\]{}&*!|>'"%@`,?]/.test(str) || str.includes('\n') || str.startsWith(' ') || str.endsWith(' ')) {
        return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return str;
};

/**
 * Normalize Ghost image URLs — replace __GHOST_URL__ placeholder with the deploy URL.
 */
const normalizeImageUrl = (url) => {
    if (!url) return null;
    return url.replace(/__GHOST_URL__/g, CONFIG.deployUrl || CONFIG.ghostUrl);
};

/**
 * Format a date (string or Date object) to YYYY-MM-DD.
 */
const formatDate = (date) => {
    if (!date) return null;
    if (date instanceof Date) {
        return date.toISOString().split('T')[0];
    }
    if (typeof date === 'object' && typeof date.toISOString === 'function') {
        return date.toISOString().split('T')[0];
    }
    return String(date).split('T')[0];
};

/**
 * Generate YAML frontmatter for a post.
 */
const generateFrontmatter = (post, tags, authors) => {
    const lines = ['---'];

    lines.push(`title: ${yamlValue(post.title)}`);
    lines.push(`slug: ${post.slug}`);
    lines.push(`date: ${formatDate(post.published_at)}`);

    if (post.updated_at && post.updated_at !== post.published_at) {
        lines.push(`updated: ${formatDate(post.updated_at)}`);
    }

    if (authors.length > 0) {
        if (authors.length === 1) {
            lines.push(`author: ${yamlValue(authors[0])}`);
        } else {
            lines.push('authors:');
            authors.forEach(a => lines.push(`  - ${yamlValue(a)}`));
        }
    }

    if (tags.length > 0) {
        lines.push('tags:');
        tags.forEach(t => lines.push(`  - ${yamlValue(t)}`));
    }

    const excerpt = post.custom_excerpt || post.plaintext?.substring(0, 160).trim() || '';
    if (excerpt) {
        lines.push(`excerpt: ${yamlValue(excerpt)}`);
    }

    const featureImage = normalizeImageUrl(post.feature_image);
    if (featureImage) {
        lines.push(`feature_image: ${yamlValue(featureImage)}`);
    }

    if (post.canonical_url) {
        lines.push(`canonical_url: ${yamlValue(post.canonical_url)}`);
    }

    lines.push('---');
    return lines.join('\n');
};

// --- Main Execution ---
(async () => {
    const timerStart = Date.now();
    console.log('📝 Ghost → Markdown Export');

    let data = null;
    let dataSource = '';

    // 1. Attempt to connect to live MySQL database
    console.log('🔍 Attempting connection to live MySQL database...');
    try {
        const mysql = require('mysql2/promise');
        const connection = await mysql.createConnection({
            ...CONFIG.db,
            connectTimeout: 2000, // 2 seconds timeout
        });

        console.log('   🔌 Connected successfully to local MySQL database.');

        // Fetch all required tables
        const [posts] = await connection.query('SELECT * FROM posts');
        const [tags] = await connection.query('SELECT * FROM tags');
        const [users] = await connection.query('SELECT * FROM users');
        const [posts_tags] = await connection.query('SELECT * FROM posts_tags');
        const [posts_authors] = await connection.query('SELECT * FROM posts_authors');

        await connection.end();

        data = { posts, tags, users, posts_tags, posts_authors };
        dataSource = 'Live MySQL Database';
    } catch (dbError) {
        console.warn(`   ⚠️  Could not connect to live database (${dbError.message}).`);
        console.log('   🔄 Falling back to reading JSON export files from disk...');

        // 2. Fallback to latest export file
        const exportFile = findLatestExport(CONFIG.ghostDataDir);

        if (!exportFile) {
            console.error('❌ No Ghost JSON export files found in ghost/content/data/ and live database is offline.');
            console.error('   Please make sure your Ghost docker containers are running or export your content from the Ghost Admin panel.');
            process.exit(1);
        }

        console.log(`   📄 Using export file: ${path.basename(exportFile)}`);
        const rawData = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
        data = rawData.data;
        dataSource = `JSON Export File (${path.basename(exportFile)})`;
    }

    console.log(`   🌐 Source: ${dataSource}`);
    console.log(`   ${data.posts.length} total entries found`);

    // 3. Build lookups
    const { postTags, postAuthors } = buildLookups(data);

    // 4. Filter to published posts only
    const posts = data.posts.filter(p => p.type === 'post' && p.status === 'published');
    console.log(`   📰 ${posts.length} published posts to export`);

    if (posts.length === 0) {
        console.log('⚠️  No published posts found. Nothing to export.');
        process.exit(0);
    }

    // 5. Prepare export directory
    fs.emptyDirSync(CONFIG.exportDir);
    console.log(`   📁 Output: ${CONFIG.exportDir}`);

    // 6. Initialize Turndown
    const turndown = createTurndownService();

    // 7. Convert and write each post
    console.log('✍️  Converting posts to Markdown...');
    let successCount = 0;
    let errorCount = 0;

    for (const post of posts) {
        try {
            const tags = postTags.get(post.id) || [];
            const authors = postAuthors.get(post.id) || [];

            // Generate frontmatter
            const frontmatter = generateFrontmatter(post, tags, authors);

            // Normalize Ghost image URLs in HTML before conversion
            let html = post.html || '';
            html = html.replace(/__GHOST_URL__/g, CONFIG.deployUrl || CONFIG.ghostUrl);

            // Convert HTML → Markdown
            const markdown = turndown.turndown(html);

            // Compose the full file content
            const fileContent = `${frontmatter}\n\n${markdown}\n`;

            // Write file
            const filename = `${post.slug}.md`;
            fs.writeFileSync(path.join(CONFIG.exportDir, filename), fileContent, 'utf8');

            successCount++;
            process.stdout.write('.');
        } catch (err) {
            errorCount++;
            console.error(`\n❌ Error converting "${post.title}" (${post.slug}): ${err.message}`);
        }
    }

    // 8. Summary
    const elapsed = ((Date.now() - timerStart) / 1000).toFixed(2);
    console.log(`\n\n🎉 EXPORT COMPLETE! (${elapsed}s)`);
    console.log(`   ✅ ${successCount} posts exported to ${CONFIG.exportDir}`);
    if (errorCount > 0) {
        console.log(`   ❌ ${errorCount} posts failed`);
    }
    console.log(`\n💡 Tip: Your markdown files are in the ./export/ directory.`);
})();
