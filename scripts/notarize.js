const { notarize } = require('@electron/notarize');
const path = require('path');

// Credentials come from the environment so they never land in git:
//   APPLE_ID=you@example.com APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx npm run build
// Generate the app-specific password at account.apple.com -> Sign-In and
// Security -> App-Specific Passwords. The team ID is public (it's in the
// signing certificate) so a default is fine.
exports.default = async function notarizing(context) {
    const { electronPlatformName, appOutDir } = context;
    if (electronPlatformName !== 'darwin') return;

    const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD } = process.env;
    if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD) {
        throw new Error(
            'Notarization requires APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD ' +
            'environment variables. See scripts/notarize.js for details.'
        );
    }

    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(appOutDir, `${appName}.app`);

    console.log(`Notarizing ${appPath}...`);

    await notarize({
        tool: 'notarytool',
        appPath,
        appleId: APPLE_ID,
        appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID || 'QLSQ27WR56'
    });

    console.log('Notarization complete.');
};
