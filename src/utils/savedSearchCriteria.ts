import type { SavedSearch } from '../services/savedSearches';

/**
 * Buy box filter values
 */
export interface BuyBox {
  minBeds?: number;
  minBaths?: number;
  maxBeds?: number;
  maxBaths?: number;
  minPrice?: number;
  maxPrice?: number;
}

/**
 * Parses dollar input string into a valid dollar amount.
 * 
 * - Trims whitespace
 * - Strips commas and $ signs
 * - Converts to number
 * - Returns undefined if empty, NaN, or < 1000 (guard against junk values)
 * - Otherwise returns integer (Math.floor)
 * 
 * @param raw - Raw input string (e.g., "$150,000", "150000", " 250000 ")
 * @returns Parsed dollar amount as integer, or undefined if invalid
 */
export function parseDollarInput(raw: string): number | undefined {
  // Trim whitespace
  const trimmed = raw.trim();
  
  // Return undefined if empty
  if (trimmed.length === 0) {
    return undefined;
  }
  
  // Strip commas and $ signs
  const cleaned = trimmed.replace(/[,$]/g, '');
  
  // Convert to number
  const num = Number(cleaned);
  
  // Return undefined if NaN
  if (Number.isNaN(num)) {
    return undefined;
  }
  
  // Guard against tiny values (junk input)
  if (num < 1000) {
    return undefined;
  }
  
  // Return integer (Math.floor)
  return Math.floor(num);
}

/**
 * Geographic bounds (NE/SW corners)
 */
export interface GeoBounds {
  ne: {
    lat: number;
    lng: number;
  };
  sw: {
    lat: number;
    lng: number;
  };
}

/**
 * Radius mode center and radius
 */
export interface RadiusCenter {
  lat: number;
  lng: number;
}

/**
 * Area mode type
 */
export type AreaMode = 'any' | 'radius' | 'polygon';

/**
 * Backward-compatible parser for location keyword from saved search criteria.
 * Checks multiple possible keys in order of preference.
 */
export function getLocationKeyword(search: SavedSearch): string | null {
  const criteria = search.criteria;
  if (!criteria || typeof criteria !== 'object') {
    return null;
  }

  // Try new format first (Step 10.26)
  if ('location_keyword' in criteria) {
    const keyword = criteria.location_keyword;
    if (typeof keyword === 'string' && keyword.trim().length > 0) {
      return keyword.trim();
    }
  }

  // Try legacy top-level keys
  const legacyKeys = ['location', 'city', 'market', 'keyword', 'area', 'search_text'];
  for (const key of legacyKeys) {
    if (key in criteria) {
      const value = criteria[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
  }

  // Try nested structures (e.g., filters.location.keyword)
  if ('filters' in criteria && typeof criteria.filters === 'object' && criteria.filters !== null) {
    const filters = criteria.filters as Record<string, unknown>;
    if ('location' in filters && typeof filters.location === 'object' && filters.location !== null) {
      const location = filters.location as Record<string, unknown>;
      if ('keyword' in location) {
        const keyword = location.keyword;
        if (typeof keyword === 'string' && keyword.trim().length > 0) {
          return keyword.trim();
        }
      }
    }
    // Also check filters directly for legacy keys
    for (const key of legacyKeys) {
      if (key in filters) {
        const value = filters[key];
        if (typeof value === 'string' && value.trim().length > 0) {
          return value.trim();
        }
      }
    }
  }

  return null;
}

/**
 * Updates the location keyword in the criteria payload without losing other fields.
 */
export function setLocationKeywordPayload(
  existingPayload: unknown,
  newKeyword: string
): Record<string, unknown> {
  // Start with existing payload or empty object
  const payload =
    existingPayload && typeof existingPayload === 'object' && existingPayload !== null
      ? { ...(existingPayload as Record<string, unknown>) }
      : {};

  // Set the new format (Step 10.26)
  payload.location_keyword = newKeyword.trim();

  // Also update legacy keys if they exist (for backward compatibility)
  const legacyKeys = ['location', 'city', 'market', 'keyword', 'area'];
  for (const key of legacyKeys) {
    if (key in payload) {
      payload[key] = newKeyword.trim();
    }
  }

  // Update nested filters.location.keyword if it exists
  if ('filters' in payload && typeof payload.filters === 'object' && payload.filters !== null) {
    const filters = { ...(payload.filters as Record<string, unknown>) };
    if ('location' in filters && typeof filters.location === 'object' && filters.location !== null) {
      const location = { ...(filters.location as Record<string, unknown>) };
      location.keyword = newKeyword.trim();
      filters.location = location;
    }
    payload.filters = filters;
  }

  return payload;
}

/**
 * Extracts buy box filters from criteria JSON.
 * Reads from criteria.buy_box namespace (new format).
 * Optionally reads from legacy top-level keys if they exist.
 */
export function getBuyBox(criteria: unknown): BuyBox {
  const result: BuyBox = {};

  if (!criteria || typeof criteria !== 'object') {
    return result;
  }

  const criteriaObj = criteria as Record<string, unknown>;

  // Try new format: criteria.buy_box
  if ('buy_box' in criteriaObj && typeof criteriaObj.buy_box === 'object' && criteriaObj.buy_box !== null) {
    const buyBox = criteriaObj.buy_box as Record<string, unknown>;
    
    if ('min_beds' in buyBox) {
      const value = buyBox.min_beds;
      if (typeof value === 'number' && !Number.isNaN(value) && value > 0) {
        result.minBeds = value;
      }
    }
    
    if ('min_baths' in buyBox) {
      const value = buyBox.min_baths;
      if (typeof value === 'number' && !Number.isNaN(value) && value > 0) {
        result.minBaths = value;
      }
    }
    
    if ('max_beds' in buyBox) {
      const value = buyBox.max_beds;
      if (typeof value === 'number' && !Number.isNaN(value) && value > 0) {
        result.maxBeds = value;
      }
    }
    
    if ('max_baths' in buyBox) {
      const value = buyBox.max_baths;
      if (typeof value === 'number' && !Number.isNaN(value) && value > 0) {
        result.maxBaths = value;
      }
    }
    
    if ('min_price' in buyBox) {
      const value = buyBox.min_price;
      if (typeof value === 'number' && !Number.isNaN(value) && value > 0) {
        result.minPrice = value;
      }
    }
    
    if ('max_price' in buyBox) {
      const value = buyBox.max_price;
      if (typeof value === 'number' && !Number.isNaN(value) && value > 0) {
        result.maxPrice = value;
      }
    }
  }

  // Optionally check legacy top-level keys (for backward compatibility)
  // Only if buy_box wasn't found
  if (Object.keys(result).length === 0) {
    if ('min_beds' in criteriaObj) {
      const value = criteriaObj.min_beds;
      if (typeof value === 'number' && !Number.isNaN(value) && value > 0) {
        result.minBeds = value;
      }
    }
    
    if ('min_baths' in criteriaObj) {
      const value = criteriaObj.min_baths;
      if (typeof value === 'number' && !Number.isNaN(value) && value > 0) {
        result.minBaths = value;
      }
    }
    
    if ('max_beds' in criteriaObj) {
      const value = criteriaObj.max_beds;
      if (typeof value === 'number' && !Number.isNaN(value) && value > 0) {
        result.maxBeds = value;
      }
    }
    
    if ('max_baths' in criteriaObj) {
      const value = criteriaObj.max_baths;
      if (typeof value === 'number' && !Number.isNaN(value) && value > 0) {
        result.maxBaths = value;
      }
    }
    
    if ('min_price' in criteriaObj) {
      const value = criteriaObj.min_price;
      if (typeof value === 'number' && !Number.isNaN(value) && value > 0) {
        result.minPrice = value;
      }
    }
    
    if ('max_price' in criteriaObj) {
      const value = criteriaObj.max_price;
      if (typeof value === 'number' && !Number.isNaN(value) && value > 0) {
        result.maxPrice = value;
      }
    }
  }

  return result;
}

/**
 * Updates buy box filters in the criteria payload without losing other fields.
 * Writes to criteria.buy_box namespace.
 */
export function setBuyBox(
  existingPayload: unknown,
  buyBox: BuyBox
): Record<string, unknown> {
  // Start with existing payload or empty object
  const payload =
    existingPayload && typeof existingPayload === 'object' && existingPayload !== null
      ? { ...(existingPayload as Record<string, unknown>) }
      : {};

  // Ensure buy_box object exists
  const buyBoxObj: Record<string, unknown> =
    'buy_box' in payload && typeof payload.buy_box === 'object' && payload.buy_box !== null
      ? { ...(payload.buy_box as Record<string, unknown>) }
      : {};

  // Set values (only if defined)
  if (buyBox.minBeds !== undefined && buyBox.minBeds !== null) {
    buyBoxObj.min_beds = buyBox.minBeds;
  } else {
    delete buyBoxObj.min_beds;
  }

  if (buyBox.minBaths !== undefined && buyBox.minBaths !== null) {
    buyBoxObj.min_baths = buyBox.minBaths;
  } else {
    delete buyBoxObj.min_baths;
  }

  if (buyBox.maxBeds !== undefined && buyBox.maxBeds !== null) {
    buyBoxObj.max_beds = buyBox.maxBeds;
  } else {
    delete buyBoxObj.max_beds;
  }

  if (buyBox.maxBaths !== undefined && buyBox.maxBaths !== null) {
    buyBoxObj.max_baths = buyBox.maxBaths;
  } else {
    delete buyBoxObj.max_baths;
  }

  // Only persist min_price if it's defined and valid (>= 1000)
  if (buyBox.minPrice !== undefined && buyBox.minPrice !== null && buyBox.minPrice >= 1000) {
    buyBoxObj.min_price = buyBox.minPrice;
  } else {
    delete buyBoxObj.min_price;
  }

  // Only persist max_price if it's defined and valid (>= 1000)
  if (buyBox.maxPrice !== undefined && buyBox.maxPrice !== null && buyBox.maxPrice >= 1000) {
    buyBoxObj.max_price = buyBox.maxPrice;
  } else {
    delete buyBoxObj.max_price;
  }

  // Only set buy_box if it has any keys
  if (Object.keys(buyBoxObj).length > 0) {
    payload.buy_box = buyBoxObj;
  } else {
    delete payload.buy_box;
  }

  return payload;
}

/**
 * Extracts geographic bounds from criteria JSON.
 * Reads from criteria.geo.bounds namespace.
 */
export function getGeoBounds(criteria: unknown): GeoBounds | null {
  if (!criteria || typeof criteria !== 'object') {
    return null;
  }

  const criteriaObj = criteria as Record<string, unknown>;

  // Try new format: criteria.geo.bounds
  if ('geo' in criteriaObj && typeof criteriaObj.geo === 'object' && criteriaObj.geo !== null) {
    const geo = criteriaObj.geo as Record<string, unknown>;
    
    if ('bounds' in geo && typeof geo.bounds === 'object' && geo.bounds !== null) {
      const bounds = geo.bounds as Record<string, unknown>;
      
      if ('ne' in bounds && typeof bounds.ne === 'object' && bounds.ne !== null) {
        const ne = bounds.ne as Record<string, unknown>;
        if ('sw' in bounds && typeof bounds.sw === 'object' && bounds.sw !== null) {
          const sw = bounds.sw as Record<string, unknown>;
          
          const neLat = ne.lat;
          const neLng = ne.lng;
          const swLat = sw.lat;
          const swLng = sw.lng;
          
          if (
            typeof neLat === 'number' &&
            typeof neLng === 'number' &&
            typeof swLat === 'number' &&
            typeof swLng === 'number' &&
            !Number.isNaN(neLat) &&
            !Number.isNaN(neLng) &&
            !Number.isNaN(swLat) &&
            !Number.isNaN(swLng)
          ) {
            return {
              ne: { lat: neLat, lng: neLng },
              sw: { lat: swLat, lng: swLng },
            };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Updates geographic bounds in the criteria payload without losing other fields.
 * Writes to criteria.geo.bounds namespace.
 * If bounds is null, removes the geo.bounds (but keeps geo if it has other keys).
 */
export function setGeoBounds(
  existingPayload: unknown,
  bounds: GeoBounds | null
): Record<string, unknown> {
  // Start with existing payload or empty object
  const payload =
    existingPayload && typeof existingPayload === 'object' && existingPayload !== null
      ? { ...(existingPayload as Record<string, unknown>) }
      : {};

  // Ensure geo object exists
  const geoObj: Record<string, unknown> =
    'geo' in payload && typeof payload.geo === 'object' && payload.geo !== null
      ? { ...(payload.geo as Record<string, unknown>) }
      : {};

  if (bounds) {
    // Set bounds
    geoObj.bounds = {
      ne: { lat: bounds.ne.lat, lng: bounds.ne.lng },
      sw: { lat: bounds.sw.lat, lng: bounds.sw.lng },
    };
  } else {
    // Remove bounds
    delete geoObj.bounds;
  }

  // Only set geo if it has any keys
  if (Object.keys(geoObj).length > 0) {
    payload.geo = geoObj;
  } else {
    delete payload.geo;
  }

  return payload;
}

/**
 * Gets area mode from criteria.
 * Returns 'any' if not set, 'radius' if area_mode = 'radius', 'polygon' if geo.bounds exists.
 */
export function getAreaMode(criteria: unknown): AreaMode {
  if (!criteria || typeof criteria !== 'object') {
    return 'any';
  }

  const criteriaObj = criteria as Record<string, unknown>;

  // Check for radius mode
  if ('area_mode' in criteriaObj && criteriaObj.area_mode === 'radius') {
    return 'radius';
  }

  // Check for polygon mode (geo.bounds exists)
  if (getGeoBounds({ criteria: criteriaObj }) !== null) {
    return 'polygon';
  }

  return 'any';
}

/**
 * Gets radius center and radius_miles from criteria.
 */
export function getRadiusCenter(criteria: unknown): { center: RadiusCenter | null; radiusMiles: number | null } {
  if (!criteria || typeof criteria !== 'object') {
    return { center: null, radiusMiles: null };
  }

  const criteriaObj = criteria as Record<string, unknown>;

  // Check for radius mode data
  if (criteriaObj.area_mode === 'radius') {
    let center: RadiusCenter | null = null;
    let radiusMiles: number | null = null;

    // Get center from criteria.center
    if ('center' in criteriaObj && typeof criteriaObj.center === 'object' && criteriaObj.center !== null) {
      const centerObj = criteriaObj.center as Record<string, unknown>;
      const lat = centerObj.lat;
      const lng = centerObj.lng;
      if (typeof lat === 'number' && typeof lng === 'number' && !Number.isNaN(lat) && !Number.isNaN(lng)) {
        center = { lat, lng };
      }
    }

    // Get radius from criteria.radius_miles
    if ('radius_miles' in criteriaObj) {
      const radius = criteriaObj.radius_miles;
      if (typeof radius === 'number' && !Number.isNaN(radius) && radius > 0) {
        radiusMiles = radius;
      }
    }

    return { center, radiusMiles };
  }

  return { center: null, radiusMiles: null };
}

/**
 * Sets radius mode in criteria payload.
 * If center or radiusMiles is null, removes radius mode.
 */
export function setRadiusMode(
  existingPayload: unknown,
  center: RadiusCenter | null,
  radiusMiles: number | null
): Record<string, unknown> {
  const payload =
    existingPayload && typeof existingPayload === 'object' && existingPayload !== null
      ? { ...(existingPayload as Record<string, unknown>) }
      : {};

  // Validate center and radius
  const isValidCenter = center !== null && 
    typeof center.lat === 'number' && 
    typeof center.lng === 'number' &&
    !Number.isNaN(center.lat) &&
    !Number.isNaN(center.lng) &&
    center.lat !== 0 &&
    center.lng !== 0;

  const isValidRadius = radiusMiles !== null && 
    typeof radiusMiles === 'number' && 
    !Number.isNaN(radiusMiles) && 
    radiusMiles > 0;

  if (isValidCenter && isValidRadius) {
    // Set radius mode
    payload.area_mode = 'radius';
    payload.center = { lat: center.lat, lng: center.lng };
    payload.radius_miles = radiusMiles;
  } else {
    // Remove radius mode
    delete payload.area_mode;
    delete payload.center;
    delete payload.radius_miles;
  }

  return payload;
}

/**
 * Gets property types from criteria.
 * Returns empty array if not set (treat as "All Types").
 */
export function getPropertyTypes(criteria: unknown): string[] {
  if (!criteria || typeof criteria !== 'object') {
    return [];
  }

  const criteriaObj = criteria as Record<string, unknown>;

  // Check for propertyTypes in criteria
  if ('propertyTypes' in criteriaObj) {
    const value = criteriaObj.propertyTypes;
    if (Array.isArray(value)) {
      // Filter to ensure all items are strings
      return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
    }
  }

  return [];
}

/**
 * Sets property types in criteria payload.
 * If propertyTypes is empty array, removes the field (treat as "All Types").
 */
export function setPropertyTypes(
  existingPayload: unknown,
  propertyTypes: string[]
): Record<string, unknown> {
  const payload =
    existingPayload && typeof existingPayload === 'object' && existingPayload !== null
      ? { ...(existingPayload as Record<string, unknown>) }
      : {};

  // Only set if array has items, otherwise remove
  if (propertyTypes.length > 0) {
    payload.propertyTypes = propertyTypes;
  } else {
    delete payload.propertyTypes;
  }

  return payload;
}

/**
 * Gets locationLabel, centerLat, centerLng, radiusMiles from criteria.
 * Returns null values if not set.
 */
export function getLocationData(criteria: unknown): {
  locationLabel: string | null;
  centerLat: number | null;
  centerLng: number | null;
  radiusMiles: number | null;
} {
  if (!criteria || typeof criteria !== 'object') {
    return { locationLabel: null, centerLat: null, centerLng: null, radiusMiles: null };
  }

  const criteriaObj = criteria as Record<string, unknown>;
  
  const locationLabel = typeof criteriaObj.locationLabel === 'string' 
    ? criteriaObj.locationLabel 
    : null;
  
  const centerLat = typeof criteriaObj.centerLat === 'number' && !Number.isNaN(criteriaObj.centerLat)
    ? criteriaObj.centerLat
    : null;
  
  const centerLng = typeof criteriaObj.centerLng === 'number' && !Number.isNaN(criteriaObj.centerLng)
    ? criteriaObj.centerLng
    : null;
  
  const radiusMiles = typeof criteriaObj.radiusMiles === 'number' && !Number.isNaN(criteriaObj.radiusMiles) && criteriaObj.radiusMiles > 0
    ? criteriaObj.radiusMiles
    : null;

  return { locationLabel, centerLat, centerLng, radiusMiles };
}

/**
 * Sets locationLabel, centerLat, centerLng, radiusMiles in criteria payload.
 * Also sets area_mode='radius', center, and radius_miles for backward compatibility.
 * If any required field is missing, removes all location fields.
 */
export function setLocationData(
  existingPayload: unknown,
  locationLabel: string | null,
  centerLat: number | null,
  centerLng: number | null,
  radiusMiles: number | null
): Record<string, unknown> {
  const payload =
    existingPayload && typeof existingPayload === 'object' && existingPayload !== null
      ? { ...(existingPayload as Record<string, unknown>) }
      : {};

  // Validate all fields are present
  const isValid = 
    locationLabel !== null && locationLabel.trim().length > 0 &&
    centerLat !== null && typeof centerLat === 'number' && !Number.isNaN(centerLat) &&
    centerLng !== null && typeof centerLng === 'number' && !Number.isNaN(centerLng) &&
    radiusMiles !== null && typeof radiusMiles === 'number' && !Number.isNaN(radiusMiles) && radiusMiles > 0;

  if (isValid) {
    // Set new format
    payload.locationLabel = locationLabel.trim();
    payload.centerLat = centerLat;
    payload.centerLng = centerLng;
    payload.radiusMiles = radiusMiles;
    
    // Also set backward-compatible format
    payload.area_mode = 'radius';
    payload.center = { lat: centerLat, lng: centerLng };
    payload.radius_miles = radiusMiles;
  } else {
    // Remove all location fields
    delete payload.locationLabel;
    delete payload.centerLat;
    delete payload.centerLng;
    delete payload.radiusMiles;
    delete payload.area_mode;
    delete payload.center;
    delete payload.radius_miles;
  }

  return payload;
}
