const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
    const { electronPlatformName, appOutDir } = context;
    if (electronPlatformName !== 'darwin') return;

    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(appOutDir, `${appName}.app`);

    console.log(`Notarizing ${appPath}...`);

    await notarize({
        tool: 'notarytool',
        appPath,
        appleId: 'gracechristianbyrd@me.com',
        appleIdPassword: 'koyk-svbd-bsfw-jwqh',
        teamId: 'QLSQ27WR56'
    });

    console.log('Notarization complete.');
};
