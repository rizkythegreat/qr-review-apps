export const routes = [
  ['GET', '/api/v1/admin/me', 'adminMe'],
  ['GET', '/api/v1/admin/dashboard', 'adminDashboard'],
  ['POST', '/api/v1/admin/batches', 'createBatch'],
  ['GET', '/api/v1/admin/batches', 'listBatches'],
  ['GET', '/api/v1/admin/batches/{batch_id}', 'getBatch'],
  ['POST', '/api/v1/admin/batches/{batch_id}/exports', 'createExport'],
  ['GET', '/api/v1/admin/exports/{export_id}', 'getExport'],
  ['GET', '/api/v1/admin/exports/{export_id}/download', 'downloadExport'],
  ['GET', '/api/v1/admin/qr-codes', 'listQr'],
  ['GET', '/api/v1/admin/qr-codes/{qr_id}', 'getQrAdmin'],
  ['GET', '/api/v1/admin/qr-codes/{qr_id}/image', 'getQrImage'],
  ['PATCH', '/api/v1/admin/qr-codes/{qr_id}/stock', 'updateStock'],
  ['POST', '/api/v1/admin/qr-codes/{qr_id}/sales', 'recordSale'],
  ['GET', '/api/v1/admin/qr-codes/{qr_id}/sales', 'getSale'],
  ['POST', '/api/v1/admin/qr-codes/{qr_id}/suspend', 'suspendQr'],
  ['POST', '/api/v1/admin/qr-codes/{qr_id}/resume', 'resumeQr'],
  ['POST', '/api/v1/admin/qr-codes/{qr_id}/retire', 'retireQr'],
  ['POST', '/api/v1/admin/qr-codes/{qr_id}/activation-code/rotate', 'rotateActivationCode'],
  ['POST', '/api/v1/admin/qr-codes/{qr_id}/pin-reset-grants', 'createPinResetGrant'],
  ['POST', '/api/v1/admin/qr-codes/{qr_id}/transfer-grants', 'createTransferGrant'],
  ['GET', '/api/v1/admin/qr-codes/{qr_id}/audit-events', 'listAuditEvents'],
  ['GET', '/api/v1/public/qr/{token}', 'getPublicQr'],
  ['POST', '/api/v1/public/qr/{token}/activate', 'activateQr'],
  ['POST', '/api/v1/owner/sessions', 'createOwnerSession'],
  ['GET', '/api/v1/owner/me', 'ownerMe'],
  ['PATCH', '/api/v1/owner/me', 'updateOwnerQr'],
  ['GET', '/api/v1/owner/me/stats', 'ownerStats'],
  ['POST', '/api/v1/owner/me/pin', 'changeOwnerPin'],
  ['POST', '/api/v1/owner/session/logout', 'logoutOwner'],
  ['POST', '/api/v1/public/pin-reset/claim', 'claimPinReset'],
  ['POST', '/api/v1/public/ownership-transfer/claim', 'claimOwnershipTransfer'],
] as const;
export type Operation = (typeof routes)[number][2];
export const idempotentOperations = new Set<Operation>([
  'createBatch',
  'createExport',
  'recordSale',
  'suspendQr',
  'resumeQr',
  'retireQr',
  'rotateActivationCode',
  'createPinResetGrant',
  'createTransferGrant',
  'activateQr',
  'claimPinReset',
  'claimOwnershipTransfer',
]);
export const versionOperations = new Set<Operation>([
  'updateStock',
  'recordSale',
  'suspendQr',
  'resumeQr',
  'retireQr',
  'rotateActivationCode',
  'createPinResetGrant',
  'createTransferGrant',
  'updateOwnerQr',
  'changeOwnerPin',
]);
export const secretOperations = new Set<Operation>([
  'rotateActivationCode',
  'createPinResetGrant',
  'createTransferGrant',
  'claimPinReset',
  'claimOwnershipTransfer',
]);
export function matchRoute(method: string, path: string) {
  for (const [m, p, id] of routes) {
    if (m !== method) continue;
    const names: string[] = [];
    const pattern = p.replace(/\{([^}]+)\}/g, (_, name) => {
      names.push(name);
      return '([^/]+)';
    });
    const match = new RegExp(`^${pattern}$`).exec(path);
    if (match)
      return { id, path: p, params: Object.fromEntries(names.map((n, i) => [n, match[i + 1]])) };
  }
  return undefined;
}
