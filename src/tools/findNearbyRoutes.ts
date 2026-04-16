import { z } from 'zod';
import { getValidToken, listAthleteRoutes } from '../stravaClient.js';

const inputSchema = z.object({
    latitude: z.number().min(-90).max(90).describe(
        'Latitude of the center point to search from. Example: 41.0082 (Istanbul), 48.8566 (Paris).'
    ),
    longitude: z.number().min(-180).max(180).describe(
        'Longitude of the center point to search from. Example: 28.9784 (Istanbul), 2.3522 (Paris).'
    ),
    maxDistanceKm: z.coerce.number().positive().default(10).describe(
        'Maximum distance in kilometers from the center point to the route start. Default: 10 km.'
    ),
    activityType: z.enum(['ride', 'run']).optional().describe(
        "Filter by activity type: 'ride' (type=1) or 'run' (type=2). Omit to return all types."
    ),
});

type FindNearbyRoutesInput = z.infer<typeof inputSchema>;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDuration(seconds: number | null | undefined): string {
    if (!seconds) return 'N/A';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const TYPE_MAP: Record<string, number> = { ride: 1, run: 2 };
const TYPE_LABEL: Record<number, string> = { 1: 'Ride', 2: 'Run' };
const SUB_TYPE_LABEL: Record<number, string> = { 1: 'Road', 2: 'MTB', 3: 'CX', 4: 'Trail', 5: 'Mixed' };

export const findNearbyRoutesTool = {
    name: 'find-nearby-routes',
    description:
        "Returns the athlete's saved routes that start within a given distance of a location. " +
        "Use when the user asks for routes near a place, nearby routes, or routes in a specific area. " +
        "Provide latitude and longitude of the target location and a max distance in km.",
    inputSchema,
    execute: async ({ latitude, longitude, maxDistanceKm, activityType }: FindNearbyRoutesInput) => {
        let token: string;
        try {
            token = await getValidToken();
        } catch (error) {
            return {
                content: [{ type: 'text' as const, text: `❌ ${error instanceof Error ? error.message : 'Authentication failed. Use the connect-strava tool.'}` }],
                isError: true,
            };
        }

        try {
            // Fetch all routes (up to 5 pages of 200 each = 1000 routes)
            const allRoutes = [];
            let page = 1;
            while (true) {
                const batch = await listAthleteRoutes(token, page, 200);
                if (batch.length === 0) break;
                allRoutes.push(...batch);
                if (batch.length < 200) break;
                page++;
            }

            if (allRoutes.length === 0) {
                return {
                    content: [{ type: 'text' as const, text: "You don't have any saved routes on Strava yet." }],
                };
            }

            // Filter by activity type
            const typeFilter = activityType ? TYPE_MAP[activityType] : null;
            const typeFiltered = typeFilter ? allRoutes.filter(r => r.type === typeFilter) : allRoutes;

            // Filter by distance using start_latlng from route or first segment
            const withDistance = typeFiltered.flatMap(route => {
                // Try route's own start_latlng first, then fall back to first segment
                const latlng =
                    (route as any).start_latlng ??
                    route.segments?.[0]?.start_latlng ??
                    null;

                if (!latlng || latlng.length < 2) return [];

                const [rLat, rLon] = latlng as [number, number];
                const distKm = haversineKm(latitude, longitude, rLat, rLon);
                if (distKm > maxDistanceKm) return [];

                return [{ route, distKm }];
            });

            if (withDistance.length === 0) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: `No routes found within ${maxDistanceKm} km of (${latitude}, ${longitude}).` +
                              (activityType ? ` Filtered by: ${activityType}.` : '') +
                              `\n\nChecked ${typeFiltered.length} route(s) total. Note: routes without location data are excluded.`,
                    }],
                };
            }

            // Sort by distance ascending
            withDistance.sort((a, b) => a.distKm - b.distKm);

            const lines = withDistance.map(({ route, distKm }) => {
                const distanceKm = (route.distance / 1000).toFixed(1);
                const elevation = route.elevation_gain != null ? Math.round(route.elevation_gain) + ' m gain' : 'N/A';
                const duration = formatDuration(route.estimated_moving_time);
                const typeLabel = TYPE_LABEL[route.type] ?? 'Unknown';
                const subLabel = SUB_TYPE_LABEL[route.sub_type] ?? '';

                return (
                    `📍 **${route.name}** — ${distKm.toFixed(1)} km away\n` +
                    `   Type: ${typeLabel}${subLabel ? ' / ' + subLabel : ''} | Distance: ${distanceKm} km | Elevation: ${elevation} | Est. time: ${duration}\n` +
                    `   ${route.description ? route.description.slice(0, 100) : ''}`
                ).trim();
            });

            const header = `Found **${withDistance.length}** route(s) within ${maxDistanceKm} km of (${latitude.toFixed(4)}, ${longitude.toFixed(4)}):\n\n`;
            return {
                content: [{ type: 'text' as const, text: header + lines.join('\n\n') }],
            };

        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: 'text' as const, text: `❌ Failed to fetch nearby routes: ${msg}` }],
                isError: true,
            };
        }
    },
};
