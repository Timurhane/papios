/**
 * Google Places adapter (K-8.8): written but OFF, because the API requires a billing account (card).
 * Enabling it needs the `adapter_google_places` feature flag and a GOOGLE_PLACES_API_KEY, see
 * docs/enable-places-and-whatsapp.md. Until then every call refuses.
 */
export interface PlaceResult {
  name: string;
  website: string | null;
  phone: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

export class PlacesDisabledError extends Error {
  override readonly name = 'PlacesDisabledError';
  constructor() {
    super('Google Places adapter is disabled (requires billing; K-8.8)');
  }
}

export class GooglePlaces {
  constructor(
    private readonly enabled: boolean,
    private readonly apiKey: string | undefined,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async textSearch(query: string): Promise<PlaceResult[]> {
    if (!this.enabled || !this.apiKey) throw new PlacesDisabledError();
    const res = await this.fetchFn('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.apiKey,
        'x-goog-fieldmask':
          'places.displayName,places.websiteUri,places.nationalPhoneNumber,places.formattedAddress,places.location',
      },
      body: JSON.stringify({ textQuery: query, languageCode: 'tr', regionCode: 'TR' }),
    });
    if (!res.ok) throw new Error(`places error ${res.status}`);
    const data = (await res.json()) as {
      places?: {
        displayName?: { text?: string };
        websiteUri?: string;
        nationalPhoneNumber?: string;
        formattedAddress?: string;
        location?: { latitude?: number; longitude?: number };
      }[];
    };
    return (data.places ?? []).map((p) => ({
      name: p.displayName?.text ?? '',
      website: p.websiteUri ?? null,
      phone: p.nationalPhoneNumber ?? null,
      address: p.formattedAddress ?? null,
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
    }));
  }
}
