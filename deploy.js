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

// UPDATE 1: Updated runCommand to accept ignoreErrors flag
const runCommand = (command, ignoreErrors = false) => {
    try {
        execSync(command, { stdio: 'inherit' });
    } catch (e) {
        if (ignoreErrors) {
            console.warn(`⚠️ WARNING: Command completed with exit code ${e.status}. Continuing anyway...`);
        } else {
            console.error(`❌ Error executing command: ${command}`);
            process.exit(1);
        }
    }
};

(async () => {
    // Dynamic import
    const { replaceInFile } = await import('replace-in-file');

    console.log(`🚀 Starting build process for: ${DEPLOY_URL}`);

    console.log('🧹 Cleaning ./dist directory...');
    fs.emptyDirSync(DIST_DIR);

    // UPDATE 2: Added 'true' to ignore wget errors (like 404s on missing assets)
    console.log('📥 Downloading content from Ghost instance...');
    // We keep -q (quiet) off so you can see progress, but ignore the final error code
    runCommand(`wget -r -nH -P ${DIST_DIR} -E -p -np ${GHOST_URL}`, true);

    console.log('🔄 Rewriting URLs...');
    const options = {
        files: `${DIST_DIR}/**/*`,
        from: new RegExp(GHOST_URL, 'g'),
        to: DEPLOY_URL,
    };

    try {
        const results = await replaceInFile(options);
        const changedFiles = results.filter(r => r.hasChanged).length;
        console.log(`✅ Processed and updated links in ${changedFiles} files.`);
    } catch (error) {
        console.error('❌ Error replacing links:', error);
        process.exit(1);
    }

    const sitemapWrong = path.join(DIST_DIR, 'sitemap.xml.html');
    const sitemapRight = path.join(DIST_DIR, 'sitemap.xml');
    
    if (fs.existsSync(sitemapWrong)) {
        fs.moveSync(sitemapWrong, sitemapRight, { overwrite: true });
        console.log('🔧 Fixed sitemap.xml extension.');
    }

    const domain = DEPLOY_URL.replace(/^https?:\/\//, '');
    fs.writeFileSync(path.join(DIST_DIR, 'CNAME'), domain);
    console.log(`📝 CNAME file created: ${domain}`);

    console.log('📤 Pushing to GitHub...');
    runCommand('npx gh-pages -d dist');

    console.log('🎉 Successfully published!');
})();