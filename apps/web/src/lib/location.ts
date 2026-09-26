export interface BrowserLocation {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
}

export const requestBrowserLocation = (): Promise<BrowserLocation> => new Promise((resolve, reject) => {
  if (!navigator.geolocation) {
    reject(new Error('Geolocation is not supported by this browser.'));
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy }),
    () => reject(new Error('Location permission was denied or unavailable.')),
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
  );
});

export const formatDate = (date: Date, language: 'en' | 'fil' = 'en'): string => new Intl.DateTimeFormat(language === 'fil' ? 'en-PH' : 'en-US', { dateStyle: 'medium' }).format(date);

export const formatDateTime = (value: string | Date, language: 'en' | 'fil' = 'en'): string => new Intl.DateTimeFormat(language === 'fil' ? 'en-PH' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
