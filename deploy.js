// deploy.js
require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

// --- Configuration ---
const CONFIG = {
    deployUrl: process.env.DEPLOY_URL,
    ghostUrl: process.env.GHOST_URL || 'http://localhost:2368',
    distDir: path.resolve(__dirname, 'dist'),
    buildOnly: process.env.BUILD_ONLY === 'true',
    // -nv: non-verbose (shows errors/summary, hides progress bars)
    wgetBase: `wget -nv -nH -E -p -np -e robots=off --restrict-file-names=windows`
};

// --- HTML Cleanup Configuration ---
// Selectors support simple classes/ids and complex CSS selectors with escaped characters
const elementsToRemove = [
    // Subscribe form in the header follow dropdown
    'body > div.site-wrapper.flex.flex-col.justify-start.min-h-screen > header > div > ul > li.dropdown.is-right.is-hoverable.hidden.relative.lg\\:block > div > div > div',
    // Login button
    'body > div.site-wrapper.flex.flex-col.justify-start.min-h-screen > header > div > ul > li.header-dropdown-menu.dropdown.is-right.is-hoverable.h-16.hidden.lg\\:flex.items-center.cursor-pointer',
    // Search button
    'body > div.site-wrapper.flex.flex-col.justify-start.min-h-screen > header > div > ul > li.js-toggle-search.hla.h-16.cursor-pointer.flex.items-center.px-2',
    // Newsletter subscribe box in sidebar
    'body > div.site-wrapper.flex.flex-col.justify-start.min-h-screen > main > div > aside > div.sidebar-subscribe.mb-8.text-center.shadow-lg.p-6.bg-primary.rounded-2xl',
    'body > div.site-wrapper.flex.flex-col.justify-start.min-h-screen > main > div.container.mx-auto.my-10 > div > aside > div.sidebar-subscribe.mb-8.text-center.shadow-lg.p-6.bg-primary.rounded-2xl',
    // Mobile login elements
    'body > div.site-wrapper.flex.flex-col.justify-start.min-h-screen > div > div.mobile-menu.w-full.fixed.inset-0.bg-blank.min-h-screen.left-auto.z-50.overflow-y-auto.overflow-x-hidden.md\\:max-w-sm > div > nav.flex.px-4.justify-around',
    'body > div.site-wrapper.flex.flex-col.justify-start.min-h-screen > div > div.mobile-menu.w-full.fixed.inset-0.bg-blank.min-h-screen.left-auto.z-50.overflow-y-auto.overflow-x-hidden.md\\:max-w-sm > div > hr:nth-child(4)',

];

// --- Validation ---
if (!CONFIG.buildOnly && !CONFIG.deployUrl) {
    console.error('❌ Error: DEPLOY_URL is missing in .env file.');
    process.exit(1);
}

// --- Helpers ---
// Escape a string for safe use inside a RegExp (URLs may contain '.', etc.)
const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const shell = (cmd, ignoreErrors = false) => {
    try {
        execSync(cmd, { stdio: 'inherit' });
    } catch (e) {
        if (!ignoreErrors) {
            console.error(`❌ Command Failed: ${cmd}`);
            throw e;
        }
        console.warn(`⚠️ Warning: Command encountered issues (ignoring) -> ${cmd}`);
    }
};

const getFiles = (dir, ext) => {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) results = results.concat(getFiles(file, ext));
        else if (!ext || file.endsWith(ext)) results.push(file);
    });
    return results;
};

// --- HTML Cleanup Function ---
const cleanHtml = (cheerio, htmlContent) => {
    const $ = cheerio.load(htmlContent);
    
    elementsToRemove.forEach(selector => {
        try {
            const $elements = $(selector);
            if ($elements.length > 0) {
                $elements.remove();
            }
        } catch (e) {
            console.warn(`⚠️ Invalid selector: "${selector}" - ${e.message}`);
        }
    });
    
    return $.html();
};

// --- Main Execution ---
(async () => {
    // Dynamic import for ESM packages
    const { replaceInFile } = await import('replace-in-file');
    const cheerio = await import('cheerio');
    const timerStart = Date.now();
    
    const buildMode = CONFIG.buildOnly ? 'Build Only' : `Production Build for: ${CONFIG.deployUrl}`;
    console.log(`🚀 Starting ${buildMode}`);

    // 1. Clean & Mirror
    console.log('🧹 Cleaning dist & Downloading Content...');
    fs.emptyDirSync(CONFIG.distDir);
    
    // Main Mirror (ignoreErrors=true to prevent crash on minor asset 404s)
    shell(`${CONFIG.wgetBase} -P ${CONFIG.distDir} -m ${CONFIG.ghostUrl}`, true);
    
    // 2. Extra Pages & Sitemaps (Best effort)
    shell(`${CONFIG.wgetBase} -P ${CONFIG.distDir} ${CONFIG.ghostUrl}/404/`, true);
    shell(`${CONFIG.wgetBase} -P ${CONFIG.distDir} ${CONFIG.ghostUrl}/rss/`, true);
    
    // 2a. Fetch Ghost Sitemaps
    console.log('🗺️  Downloading sitemaps...');
    const sitemaps = [
        'sitemap.xml',
        'sitemap-pages.xml',
        'sitemap-posts.xml',
        'sitemap-authors.xml',
        'sitemap-tags.xml'
    ];
    
    let sitemapCount = 0;
    for (const sitemap of sitemaps) {
        const destPath = path.join(CONFIG.distDir, sitemap);
        try {
            execSync(`wget -q -O "${destPath}" "${CONFIG.ghostUrl}/${sitemap}"`, { stdio: 'pipe' });
            // Verify file has content (Ghost returns empty/error pages for missing sitemaps)
            const stat = fs.statSync(destPath);
            if (stat.size > 0) {
                sitemapCount++;
                process.stdout.write('.');
            } else {
                fs.removeSync(destPath);
            }
        } catch (e) {
            // Ignore errors - sitemap might not exist
            if (fs.existsSync(destPath)) fs.removeSync(destPath);
        }
    }
    console.log(sitemapCount > 0 ? `\n✅ Downloaded ${sitemapCount} sitemaps.` : '\n⚠️  No sitemaps found.');

    // 3. Asset Scraper (Fix missing Ghost assets)
    console.log('🕷️  Auditing & Fetching missing assets...');
    const scanFiles = [...getFiles(CONFIG.distDir, '.html'), ...getFiles(CONFIG.distDir, '.js')];
    const foundAssets = new Set();
    
    const srcPattern = /(?:src|srcset)=["']([^"']+)["']/g;
    const genericPattern = /(?:'|")(\/(?:content\/images|assets)\/[^"']+)(?:'|")/g;

    for (const file of scanFiles) {
        const content = fs.readFileSync(file, 'utf8');
        
        const srcMatches = [...content.matchAll(srcPattern)];
        srcMatches.forEach(match => {
            const urls = match[1].split(',').map(u => u.trim().split(/\s+/)[0]);
            urls.forEach(url => {
                if (url.includes('/content/') || url.includes('/assets/')) {
                    foundAssets.add(decodeURIComponent(url.split(/[?#]/)[0]));
                }
            });
        });
        
        const genericMatches = [...content.matchAll(genericPattern)];
        genericMatches.forEach(match => {
            foundAssets.add(decodeURIComponent(match[1].split(/[?#]/)[0]));
        });
    }

    let dlCount = 0;
    for (const rawPath of foundAssets) {
        const relativePath = rawPath.replace(/^https?:\/\/[^\/]+/, '');
        if (!relativePath.startsWith('/')) continue;
        
        const localDest = path.join(CONFIG.distDir, relativePath);
        if (!fs.existsSync(localDest)) {
            fs.ensureDirSync(path.dirname(localDest));
            try {
                execSync(`wget -q -O "${localDest}" "${CONFIG.ghostUrl}${relativePath}"`);
                dlCount++;
                process.stdout.write('.');
            } catch (e) { /* ignore specific 404s */ }
        }
    }
    console.log(dlCount > 0 ? `\n✅ Fetched ${dlCount} extra assets.` : '\n✅ No missing assets found.');

    // 4. Sanitization & Structuring
    console.log('✨ Sanitizing Files & Paths...');
    
    // 4a. File Renaming (Strip query strings from filenames)
    getFiles(CONFIG.distDir).forEach(file => {
        if (/[?=@]/.test(file)) {
            const clean = file.split(/[?=@]/)[0];
            fs.existsSync(clean) ? fs.removeSync(file) : fs.moveSync(file, clean);
        }
    });

    // 4b. Structural Fixes (404)
    const moves = [
        { src: '404/index.html', dest: '404.html' }
    ];

    moves.forEach(({ src, dest }) => {
        const srcPath = path.join(CONFIG.distDir, src);
        if (fs.existsSync(srcPath)) {
            fs.moveSync(srcPath, path.join(CONFIG.distDir, dest), { overwrite: true });
            if (src.includes('/')) fs.removeSync(path.dirname(srcPath));
        }
    });

    // 5. Content Replacements (Domain & Cleanup)
    console.log('🔄 Rewriting HTML & sitemap content...');
    await replaceInFile({
        files: `${CONFIG.distDir}/**/*.html`,
        from: [
            new RegExp(escapeRegExp(CONFIG.ghostUrl), 'g'), // Swap Domain
            /((?:\.css|\.js|\.png|\.jpg|\.svg|\.webp))([?@][^"'\s>]*)/g, // Remove cache busters
            /<script\b[^>]*ghost-portal[^>]*><\/script>/g // Remove Ghost Portal
        ],
        to: [CONFIG.deployUrl, '$1', ''],
    });
    
    // 5a. Fix sitemap URLs (including stylesheet references)
    const ghostDomain = CONFIG.ghostUrl.replace(/^https?:\/\//, '');
    const deployDomain = CONFIG.deployUrl.replace(/^https?:\/\//, '');
    await replaceInFile({
        files: `${CONFIG.distDir}/**/*.xml`,
        from: [
            new RegExp(escapeRegExp(CONFIG.ghostUrl), 'g'),
            new RegExp(escapeRegExp(`//${ghostDomain}`), 'g'),
            /<\?xml-stylesheet[^?]*\?>/g  // Remove XSL stylesheet reference
        ],
        to: [
            CONFIG.deployUrl,
            `//${deployDomain}`,
            ''
        ],
    });

    // 5b. HTML Element Cleanup
    console.log('🧽 Cleaning HTML elements...');
    const htmlFilesToClean = getFiles(CONFIG.distDir, '.html');
    htmlFilesToClean.forEach(file => {
        const htmlContent = fs.readFileSync(file, 'utf8');
        const cleanedHtml = cleanHtml(cheerio, htmlContent);
        fs.writeFileSync(file, cleanedHtml, 'utf8');
        process.stdout.write('.');
    });
    console.log(`\n✅ Cleaned ${htmlFilesToClean.length} HTML files.`);

    // 6. Deploy Preparation & Push
    if (!CONFIG.buildOnly) {
        console.log('📦 Finalizing for GitHub Pages...');
        const domain = CONFIG.deployUrl.replace(/^https?:\/\//, '');
        fs.writeFileSync(path.join(CONFIG.distDir, 'CNAME'), domain);
        fs.writeFileSync(path.join(CONFIG.distDir, '.nojekyll'), '');

        // 7. Push
        console.log('📤 Deploying to GitHub...');
        shell('npx gh-pages -d dist --add -t --dotfiles', true);

        console.log(`🎉 DEPLOYMENT SUCCESSFUL! (${((Date.now() - timerStart)/1000).toFixed(2)}s)`);
    } else {
        console.log(`🎉 BUILD COMPLETE! (${((Date.now() - timerStart)/1000).toFixed(2)}s)`);
        console.log(`📁 Output directory: ${CONFIG.distDir}`);
    }
})();