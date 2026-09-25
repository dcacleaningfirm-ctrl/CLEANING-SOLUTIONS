import { geocodeAddress, serverKey, serviceCenter } from "./maps.js";
import { milesBetween, withinServiceRadius } from "./service-radius.js";

export async function checkServiceAddress(input: { address: string; city: string; state: string; zip: string }): Promise<{ error: string; status: number } | null> {
  const { address, city, state, zip } = input;
  if (!address.trim() || !city.trim() || !/^\d{5}(?:-\d{4})?$/.test(zip.trim())) {
    return { error: "Enter the full service street address, city and ZIP to check our 45-mile service area.", status: 400 };
  }
  if (!/^(GA|Georgia)$/i.test(state.trim())) {
    return { error: "This address is outside DCA's 45-mile Atlanta service area. No order or deposit was created.", status: 422 };
  }
  if (!serverKey()) {
    return { error: "Address verification is temporarily unavailable. Please call DCA before placing an order.", status: 503 };
  }
  const lookup = await geocodeAddress([address, city, state, zip].join(", "), 3);
  const location = lookup.places.find((place) =>
    place.precision === "exact" &&
    place.parts.state.toUpperCase() === "GA" &&
    place.parts.zip.slice(0, 5) === zip.slice(0, 5)
  );
  if (!location) {
    return { error: "We could not verify that service address. Check the street, city, state and ZIP, then try again. No order or deposit was created.", status: 422 };
  }
  if (!withinServiceRadius(location, serviceCenter())) {
    return { error: `This service address is ${Math.round(milesBetween(location, serviceCenter()))} miles from our Atlanta service center, outside our 45-mile radius. No order or deposit was created.`, status: 422 };
  }
  return null;
}
