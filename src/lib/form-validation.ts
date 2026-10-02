import { ApiFailure } from './api';
import { supportedReviewUrl } from './format';

export function fieldFailure(field: string, message: string): never {
  throw new ApiFailure('VALIDATION_ERROR', 'Periksa isian yang ditandai.', 422, [
    { field, message },
  ]);
}
export function validateStore(store_name: string, review_url: string) {
  if (Array.from(store_name.trim()).length < 1 || Array.from(store_name.trim()).length > 120)
    fieldFailure('store_name', 'Nama toko harus berisi 1–120 karakter.');
  if (!supportedReviewUrl(review_url))
    fieldFailure(
      'review_url',
      'Gunakan link Google Review yang didukung. Lihat panduan di bawah isian.',
    );
}
export function validatePins(
  pin: string,
  confirmation: string,
  name = 'pin',
  confirmationName = 'pin_confirmation',
) {
  if (!/^[0-9]{4}$/.test(pin)) fieldFailure(name, 'PIN harus terdiri dari empat digit angka.');
  if (pin !== confirmation) fieldFailure(confirmationName, 'Konfirmasi PIN tidak sama.');
}
