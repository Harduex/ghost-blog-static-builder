// deploy.js
require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

// Configuration
const DEPLOY_URL = process.env.DEPLOY_URL;
const GHOST_URL = process.env.GHOST_URL || 'http://localhost:2368';
const DIST_DIR = './dist';

if (!DEPLOY_URL) {
    console.error('❌ ERROR: DEPLOY_URL is missing in the .env file!');
    process.exit(1);
}

const runCommand = (command, ignoreErrors = false) => {
    try {
        execSync(command, { stdio: 'inherit' });
    } catch (e) {
        if (!ignoreErrors) {
            console.error(`❌ Error executing command: ${command}`);
            process.exit(1);
        }
    }
};

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
    const { replaceInFile } = await import('replace-in-file');

    console.log(`🚀 Starting ROBUST AUTONOMOUS build for: ${DEPLOY_URL}`);
    
    // 1. Clean
    console.log('🧹 Cleaning ./dist directory...');
    fs.emptyDirSync(DIST_DIR);

    // 2. Main Download
    console.log('📥 Downloading core content...');
    try {
        execSync(`wget -m -nH -P ${DIST_DIR} -E -p -np -e robots=off --restrict-file-names=windows ${GHOST_URL}`, { stdio: 'inherit' });
    } catch (e) {
        console.warn('⚠️ Main wget finished with warnings. Continuing...');
    }

    // 3. Extra Pages
    console.log('🔍 Fetching special pages (404, RSS)...');
    runCommand(`wget -q -nH -P ${DIST_DIR} -E -p --restrict-file-names=windows ${GHOST_URL}/404/`, true);
    runCommand(`wget -q -nH -P ${DIST_DIR} -E -p --restrict-file-names=windows ${GHOST_URL}/rss/`, true);

    // 4. ADVANCED IMAGE SCRAPER (Fixes missing srcset images)
    console.log('🕷️ Scraping ALL images (src + srcset)...');
    
    const htmlFiles = getAllFiles(DIST_DIR).filter(file => file.endsWith('.html'));
    const foundImages = new Set();
    
    // Regex to find src="..." and srcset="..." containing /content/images/
    // This is safer than raw matching
    const attributeRegex = /(?:src|srcset)=["']([^"']+)["']/g;

    htmlFiles.forEach(file => {
        const content = fs.readFileSync(file, 'utf8');
        let match;
        while ((match = attributeRegex.exec(content)) !== null) {
            const rawValue = match[1]; // The content inside "..."
            
            // If it's a srcset, it looks like: "/path/img.png 600w, /path/img2.png 1000w"
            // We need to split by comma
            const candidates = rawValue.split(',');

            candidates.forEach(candidate => {
                // Take the first part (the URL), ignore the width (600w)
                let cleanUrl = candidate.trim().split(/\s+/)[0];
                
                // Only care if it looks like a Ghost image
                if (cleanUrl.includes('/content/images/')) {
                     // Clean query strings (?v=...)
                    cleanUrl = cleanUrl.split('?')[0];
                    // Decode URI (fix %20 spaces)
                    cleanUrl = decodeURIComponent(cleanUrl);
                    foundImages.add(cleanUrl);
                }
            });
        }
    });

    // 4.2 Download missing images
    let downloadedCount = 0;
    let failedCount = 0;
    console.log(`🔎 Found ${foundImages.size} potential unique image references. Checking disk...`);

    for (const imgPath of foundImages) {
        // imgPath is e.g. /content/images/size/w600/2025/12/img.png
        
        // Remove domain if it crept in (replace localhost or prod domain)
        let relativePath = imgPath.replace(/^https?:\/\/[^\/]+/, '');
        
        // Construct local path: dist/content/images/...
        const localFile = path.join(DIST_DIR, relativePath); 
        
        if (!fs.existsSync(localFile)) {
            const fullUrl = `${GHOST_URL}${relativePath}`;
            const targetDir = path.dirname(localFile);
            
            fs.ensureDirSync(targetDir);
            
            try {
                // Try to download
                execSync(`wget -q -O "${localFile}" "${fullUrl}"`);
                process.stdout.write('.'); 
                downloadedCount++;
            } catch (e) {
                // If 404, Ghost fails to generate the size on the fly via wget sometimes
                process.stdout.write('x');
                failedCount++;
                // console.log(`\n❌ Failed to dl: ${fullUrl}`); // Uncomment to debug
            }
        }
    }
    console.log(`\n✅ Downloaded ${downloadedCount} new assets.`);
    if (failedCount > 0) console.warn(`⚠️ Failed to download ${failedCount} assets (likely 404s from Ghost).`);

    // 5. SANITIZE FILENAMES
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

    // 404 Fix
    const fourOhFourSrc = path.join(DIST_DIR, '404', 'index.html');
    const fourOhFourDest = path.join(DIST_DIR, '404.html');
    if (fs.existsSync(fourOhFourSrc)) {
        fs.moveSync(fourOhFourSrc, fourOhFourDest, { overwrite: true });
        fs.removeSync(path.join(DIST_DIR, '404'));
    }

    // URL Rewrite
    await replaceInFile({
        files: `${DIST_DIR}/**/*.html`,
        from: new RegExp(GHOST_URL, 'g'),
        to: DEPLOY_URL,
    });

    // Clean Versions
    await replaceInFile({
        files: `${DIST_DIR}/**/*.html`,
        from: /((?:\.css|\.js|\.png|\.jpg|\.jpeg|\.gif|\.svg|\.webp))([?@][^"'\s>]*)/g,
        to: '$1',
    });

    // Remove Portal
    await replaceInFile({
        files: `${DIST_DIR}/**/*.html`,
        from: /<script.*ghost-portal.*><\/script>/g,
        to: '',
    });

    // Sitemap Fix
    const sitemapWrong = path.join(DIST_DIR, 'sitemap.xml.html');
    const sitemapRight = path.join(DIST_DIR, 'sitemap.xml');
    if (fs.existsSync(sitemapWrong)) fs.moveSync(sitemapWrong, sitemapRight, { overwrite: true });

    // 7. Deploy
    const domain = DEPLOY_URL.replace(/^https?:\/\//, '');
    fs.writeFileSync(path.join(DIST_DIR, 'CNAME'), domain);
    
    // Create .nojekyll to disable Jekyll processing
    fs.writeFileSync(path.join(DIST_DIR, '.nojekyll'), '');
    
    // Create a minimal .gitignore for the gh-pages branch (don't ignore content!)
    fs.writeFileSync(path.join(DIST_DIR, '.gitignore'), 'node_modules/\n');

    console.log('📤 Pushing to GitHub...');
    // Use --no-gitignore flag to deploy content folder despite .gitignore
    runCommand('npx gh-pages -d dist --add -t', true);

    console.log('🎉 DEPLOYMENT COMPLETE!');
})();