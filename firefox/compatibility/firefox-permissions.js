const params = new URLSearchParams(location.search);
const token = params.get('token');
const permissions = JSON.parse(params.get('permissions') || '[]');
const optional = browser.runtime.getManifest().optional_permissions || [];
const descriptions = {
    webNavigation: 'Observe navigation to keep page features working.',
    menus: 'Add RoValra actions to the right-click menu.',
    webRequest: 'Observe Roblox requests for optional page fixes.',
};
for (const permission of permissions) {
    const item = document.createElement('li');
    item.textContent = descriptions[permission] || permission;
    document.getElementById('permissions').append(item);
}
const valid = token && permissions.length && permissions.every((item) => optional.includes(item));
document.getElementById('allow').disabled = !valid;
async function finish() {
    await browser.runtime.sendMessage({ action: 'firefoxPermissionResult', token });
    window.close();
}
document.getElementById('allow').addEventListener('click', () => {
    browser.permissions.request({ permissions }).then(finish).catch((error) => {
        document.getElementById('status').textContent = error.message;
    });
});
document.getElementById('cancel').addEventListener('click', finish);
