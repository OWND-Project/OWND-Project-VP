export const isExpired = (issuedAt: number, expiredIn: number): boolean => {
  const currentTime = Math.floor(new Date().getTime() / 1000);
  const expirationTime = issuedAt + expiredIn;
  return currentTime > expirationTime;
};

export const getCurrentUnixTimeInSeconds = (): number =>
  Math.floor(new Date().getTime() / 1000);
