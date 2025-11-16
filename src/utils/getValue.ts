export const getNIM = (email: string): string | null => {
  const match = email.match(/^(\d+)@students\.uin-suska\.ac\.id$/);
  return match ? match[1] : null;
};

export const getBatch = (email: string): string | null => {
  const match = email.match(/^(\d+)@students\.uin-suska\.ac\.id$/);

  if (!match) return null;

  const nim = match[1];

  const digit = nim.substring(1, 3);

  const currentYear = new Date().getFullYear();
  const baseYear = 2000;

  // Hitung tahun angkatan
  const angkatan = baseYear + parseInt(digit, 10);

  if (angkatan > currentYear) {
    return null;
  }

  return angkatan.toString();
};