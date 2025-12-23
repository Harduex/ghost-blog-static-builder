// deploy.js
require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

// Configuration
const DEPLOY_URL = process.env.DEPLOY_URL;
const GHOST_URL = process.env.GHOST_URL || 'http://localhost:2368';
const DIST_DIR = './dist';

// Validation
if (!DEPLOY_URL) {
    console.error('❌ ERROR: DEPLOY_URL is missing in the .env file!');
    process.exit(1);
}

/**
 * Helper to run shell commands.
 * Use ignoreErrors=true for commands that might return non-zero exit codes (like wget with 404s).
 */
const runCommand = (command, ignoreErrors = false) => {
    try {
        // Using 'pipe' to prevent console spam during loops, unless it's a main command
        execSync(command, { stdio: 'inherit' });
    } catch (e) {
        if (!ignoreErrors) {
            console.error(`❌ Error executing command: ${command}`);
            process.exit(1);
        }
    }
};

/**
 * Recursive file walker to find all files in a directory.
 */
const getAllFiles = function(dirPath, arrayOfFiles) {
    const files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];
    files.forEach(function(file) {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
        } else {
            arrayOfFiles.push(path.join(dirPath, "/", file));
        }
    });
    return arrayOfFiles;
};

(async () => {
    // Dynamic import for ES Module compatibility
    const { replaceInFile } = await import('replace-in-file');

    console.log(`🚀 Starting AUTONOMOUS build for: ${DEPLOY_URL}`);
    
    // 1. Clean output directory
    console.log('🧹 Cleaning ./dist directory...');
    fs.emptyDirSync(DIST_DIR);

    // 2. Main Download (Core HTML/CSS/JS structure)
    console.log('📥 Downloading core content...');
    try {
        // -m: mirror (suitable for static sites)
        // -nH: no-host-directories
        // -E: adjust-extension (converts clean URLs to .html)
        // -p: page-requisites (css/js/images)
        // -np: no-parent
        execSync(`wget -m -nH -P ${DIST_DIR} -E -p -np -e robots=off --restrict-file-names=windows ${GHOST_URL}`, { stdio: 'inherit' });
    } catch (e) {
        console.warn('⚠️ Main wget finished with warnings (common for dynamic sites). Continuing...');
    }

    // 3. Fetch Extra Pages (404 and RSS)
    console.log('🔍 Fetching special pages (404, RSS)...');
    runCommand(`wget -q -nH -P ${DIST_DIR} -E -p --restrict-file-names=windows ${GHOST_URL}/404/`, true);
    runCommand(`wget -q -nH -P ${DIST_DIR} -E -p --restrict-file-names=windows ${GHOST_URL}/rss/`, true);

    // 4. SMART IMAGE SCRAPER
    // Scans downloaded HTML for images missed by wget (due to lazy-loading or srcset)
    console.log('🕷️ Scraping missing images (checking for lazy-loaded assets)...');
    
    const htmlFiles = getAllFiles(DIST_DIR).filter(file => file.endsWith('.html'));
    const foundImages = new Set();
    
    // Regex to find Ghost image paths (e.g., /content/images/...)
    const imageRegex = /\/content\/images\/[^"'\s),]+/g;

    // 4.1 Collect all image links from HTML files
    htmlFiles.forEach(file => {
        const content = fs.readFileSync(file, 'utf8');
        const matches = content.match(imageRegex);
        if (matches) {
            matches.forEach(img => {
                // Clean potential query parameters
                let cleanUrl = img.split('?')[0]; 
                foundImages.add(cleanUrl);
            });
        }
    });

    // 4.2 Download missing images
    let downloadedCount = 0;
    console.log(`🔎 Found ${foundImages.size} potential image references. Verifying...`);

    for (const imgPath of foundImages) {
        // Construct local path: dist/content/images/...
        const localFile = path.join(DIST_DIR, imgPath); 
        
        if (!fs.existsSync(localFile)) {
            const fullUrl = `${GHOST_URL}${imgPath}`;
            const targetDir = path.dirname(localFile);
            
            fs.ensureDirSync(targetDir);
            
            try {
                // Quiet download for specific asset
                execSync(`wget -q -O "${localFile}" "${fullUrl}"`);
                process.stdout.write('.'); // Progress indicator
                downloadedCount++;
            } catch (e) {
                // Ignore 404s for specific images
            }
        }
    }
    console.log(`\n✅ Downloaded ${downloadedCount} missing assets.`);

    // 5. SANITIZE FILENAMES
    // Removes query strings like ?v=123 causing issues on GitHub Pages
    console.log('✨ Sanitizing filenames...');
    const allFiles = getAllFiles(DIST_DIR);
    allFiles.forEach(filePath => {
        if (filePath.match(/[?=@]/)) {
            const cleanPath = filePath.split(/[?=@]/)[0];
            if (!fs.existsSync(cleanPath)) {
                fs.moveSync(filePath, cleanPath);
            } else {
                fs.removeSync(filePath);
            }
        }
    });

    // 6. FIXES & CLEANUP
    console.log('🔄 Rewriting URLs and cleaning HTML...');

    // 6.1 Move 404 page to root
    const fourOhFourSrc = path.join(DIST_DIR, '404', 'index.html');
    const fourOhFourDest = path.join(DIST_DIR, '404.html');
    if (fs.existsSync(fourOhFourSrc)) {
        fs.moveSync(fourOhFourSrc, fourOhFourDest, { overwrite: true });
        fs.removeSync(path.join(DIST_DIR, '404'));
    }

    // 6.2 Replace Localhost with Production URL
    await replaceInFile({
        files: `${DIST_DIR}/**/*.html`,
        from: new RegExp(GHOST_URL, 'g'),
        to: DEPLOY_URL,
    });

    // 6.3 Remove version parameters from HTML references (href="style.css?v=...")
    await replaceInFile({
        files: `${DIST_DIR}/**/*.html`,
        from: /((?:\.css|\.js|\.png|\.jpg|\.jpeg|\.gif|\.svg|\.webp))([?@][^"'\s>]*)/g,
        to: '$1',
    });

    // 6.4 Remove Ghost Portal script (dynamic membership features don't work on static)
    await replaceInFile({
        files: `${DIST_DIR}/**/*.html`,
        from: /<script.*ghost-portal.*><\/script>/g,
        to: '',
    });

    // 6.5 Fix Sitemap extension
    const sitemapWrong = path.join(DIST_DIR, 'sitemap.xml.html');
    const sitemapRight = path.join(DIST_DIR, 'sitemap.xml');
    if (fs.existsSync(sitemapWrong)) fs.moveSync(sitemapWrong, sitemapRight, { overwrite: true });

    // 7. CNAME & DEPLOY
    const domain = DEPLOY_URL.replace(/^https?:\/\//, '');
    fs.writeFileSync(path.join(DIST_DIR, 'CNAME'), domain);

    console.log('📤 Pushing to GitHub...');
    runCommand('npx gh-pages -d dist', true);

    console.log('🎉 DEPLOYMENT COMPLETE!');
})();