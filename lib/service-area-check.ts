import { geocodeAddress, serverKey, serviceCenter } from "./maps.js";
import { milesBetween, withinServiceRadius } from "./service-radius.js";

type ServiceAreaError = { error: string; status: number };

// Office and voice bookings can carry one complete address instead of separate
// city fields. Always resolve it on the server; client coordinates are not proof.
export async function checkServiceAddressText(address: string, expectedZip?: string): Promise<ServiceAreaError | null> {
  if (!address.trim()) {
    return { error: "Enter the full service address to check our 50-mile service area.", status: 400 };
  }
  if (!serverKey()) {
    return { error: "Address verification is temporarily unavailable. Please call DCA before placing an order.", status: 503 };
  }
  const lookup = await geocodeAddress(address.trim(), 3);
  if (lookup.error && !lookup.places.length) {
    return { error: "Address verification is temporarily unavailable. Please call DCA before placing an order.", status: 503 };
  }
  const location = lookup.places.find((place) =>
    place.precision === "exact" &&
    (!expectedZip || place.parts.zip.slice(0, 5) === expectedZip.trim().slice(0, 5))
  );
  if (!location) {
    return { error: "We could not verify that service address. Check the street, city, state and ZIP, then try again. No order or deposit was created.", status: 422 };
  }
  if (location.parts.state.toUpperCase() !== "GA" || !withinServiceRadius(location, serviceCenter())) {
    return { error: `This service address is outside DCA's 50-mile Atlanta service area (${Math.round(milesBetween(location, serviceCenter()))} miles from our service center). No order or deposit was created.`, status: 422 };
  }
  return null;
}

export async function checkServiceAddress(input: { address: string; city: string; state: string; zip: string }): Promise<ServiceAreaError | null> {
  const { address, city, state, zip } = input;
  if (!address.trim() || !city.trim() || !/^\d{5}(?:-\d{4})?$/.test(zip.trim())) {
    return { error: "Enter the full service street address, city and ZIP to check our 50-mile service area.", status: 400 };
  }
  if (!/^(GA|Georgia)$/i.test(state.trim())) {
    return { error: "This address is outside DCA's 50-mile Atlanta service area. No order or deposit was created.", status: 422 };
  }
  return checkServiceAddressText([address.trim(), city.trim(), state.trim(), zip.trim()].join(", "), zip);
}
