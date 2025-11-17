export const getFQDN = (url: string): string | null => {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname;
  } catch (error) {
    console.error("Invalid URL:", error);
    return null;
  }
};
