const { notarize } = require('@electron/notarize');
const path = require('path');

// Credentials come from the macOS keychain profile "audiobroadcaster",
// created once with:
//   xcrun notarytool store-credentials audiobroadcaster \
//     --apple-id <apple-id> --team-id QLSQ27WR56 --password <app-specific-password>
// After that, plain `npm run build` notarizes with no secrets in files or env.
//
// APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD environment variables override the
// keychain when set (useful for CI, where there is no keychain profile).
exports.default = async function notarizing(context) {
    const { electronPlatformName, appOutDir } = context;
    if (electronPlatformName !== 'darwin') return;

    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(appOutDir, `${appName}.app`);

    const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD } = process.env;
    const auth = (APPLE_ID && APPLE_APP_SPECIFIC_PASSWORD)
        ? {
            appleId: APPLE_ID,
            appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID || 'QLSQ27WR56'
        }
        : { keychainProfile: 'audiobroadcaster' };

    console.log(`Notarizing ${appPath}...`);

    await notarize({
        tool: 'notarytool',
        appPath,
        ...auth
    });

    console.log('Notarization complete.');
};
