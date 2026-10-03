export const auditActions: Record<string, string> = {
  BATCH_GENERATED: 'Unit dibuat',
  STOCK_AVAILABLE: 'Unit siap dijual',
  STOCK_DAMAGED: 'Unit rusak',
  SALE_RECORDED: 'Penjualan tercatat',
  ACTIVATED: 'QR diaktifkan',
  OWNER_UPDATED: 'Data toko diubah',
  PIN_CHANGED: 'PIN diubah',
  PIN_RESET_GRANT_CREATED: 'Tautan reset PIN dibuat',
  OWNERSHIP_TRANSFER_GRANT_CREATED: 'Tautan transfer dibuat',
  PIN_RESET_CLAIMED: 'PIN dipulihkan',
  OWNERSHIP_TRANSFER_CLAIMED: 'Kepemilikan dipindahkan',
  suspendQr: 'QR ditangguhkan',
  resumeQr: 'QR dilanjutkan',
  retireQr: 'QR dinonaktifkan',
  ACTIVATION_CODE_ROTATED: 'Kode aktivasi dirotasi',
  SUSPENDED: 'QR ditangguhkan',
  RESUMED: 'QR dilanjutkan',
  RETIRED: 'QR dinonaktifkan',
};

export const auditActionAliases: Record<string, string[]> = {
  suspendQr: ['suspendQr', 'SUSPENDED'],
  resumeQr: ['resumeQr', 'RESUMED'],
  retireQr: ['retireQr', 'RETIRED'],
};
