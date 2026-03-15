import Cartesian3 from "terriajs-cesium/Source/Core/Cartesian3";
import NearFarScalar from "terriajs-cesium/Source/Core/NearFarScalar";
import CustomDataSource from "terriajs-cesium/Source/DataSources/CustomDataSource";
import HeightReference from "terriajs-cesium/Source/Scene/HeightReference";

const AIRPLANE_SVG =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiIgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIj4KICA8cGF0aCBkPSJNMTYgMyBMMTQuNSAxMSBMNiAxNSBMNiAxNyBMMTQuNSAxNS41IEwxNC41IDI0IEwxMS41IDI2LjUgTDExLjUgMjggTDE2IDI2LjUgTDIwLjUgMjggTDIwLjUgMjYuNSBMMTcuNSAyNCBMMTcuNSAxNS41IEwyNiAxNyBMMjYgMTUgTDE3LjUgMTEgWiIgZmlsbD0iI0ZGRDYwMCIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjEuMiIvPgo8L3N2Zz4K";

const DEG2RAD = Math.PI / 180;
const EARTH_RADIUS = 6371000;

function headingToEcefUnit(latDeg, lonDeg, headingDeg) {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const h = headingDeg * DEG2RAD;
  const nx = -Math.sin(lat) * Math.cos(lon);
  const ny = -Math.sin(lat) * Math.sin(lon);
  const nz = Math.cos(lat);
  const ex = -Math.sin(lon);
  const ey = Math.cos(lon);
  return new Cartesian3(
    Math.cos(h) * nx + Math.sin(h) * ex,
    Math.cos(h) * ny + Math.sin(h) * ey,
    Math.cos(h) * nz
  );
}

function extrapolate(lat, lon, velocityMs, headingDeg, dtSeconds) {
  const d = velocityMs * dtSeconds;
  const h = headingDeg * DEG2RAD;
  const lat1 = lat * DEG2RAD;
  const lon1 = lon * DEG2RAD;
  const ad = d / EARTH_RADIUS;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ad) + Math.cos(lat1) * Math.sin(ad) * Math.cos(h)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(h) * Math.sin(ad) * Math.cos(lat1),
      Math.cos(ad) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { lat: lat2 / DEG2RAD, lon: lon2 / DEG2RAD };
}

export function startLiveAircraft(terria, adapterUrl, pollIntervalMs = 5000) {
  const dataSource = new CustomDataSource("LiveAircraft");
  const aircraft = new Map();
  let lastFrameTime = 0;

  // Wait for Cesium viewer to be ready, then add data source
  function tryAttach() {
    const cesium = terria.cesium;
    if (cesium && cesium.dataSourceDisplay) {
      cesium.dataSourceDisplay.dataSources.add(dataSource);
      poll();
      setInterval(poll, pollIntervalMs);
      requestAnimationFrame(animate);
      console.log("[LiveAircraft] started");
    } else {
      setTimeout(tryAttach, 1000);
    }
  }

  async function poll() {
    try {
      const resp = await fetch(adapterUrl);
      if (!resp.ok) return;
      const data = await resp.json();
      const seen = new Set();

      for (const row of data.rows) {
        seen.add(row.icao24);
        const existing = aircraft.get(row.icao24);

        if (existing) {
          existing.lat = row.latitude;
          existing.lon = row.longitude;
          existing.alt = row.geo_altitude ?? existing.alt;
          existing.velocity = row.velocity ?? 0;
          existing.heading = row.true_track ?? existing.heading;
          if (row.true_track !== null) {
            existing.entity.billboard.alignedAxis = headingToEcefUnit(
              row.latitude,
              row.longitude,
              row.true_track
            );
          }
        } else {
          const alt = row.geo_altitude ?? 10000;
          const heading = row.true_track ?? 0;
          const entity = dataSource.entities.add({
            id: row.icao24,
            name: row.callsign || row.icao24,
            position: Cartesian3.fromDegrees(row.longitude, row.latitude, alt),
            billboard: {
              image: AIRPLANE_SVG,
              scale: 0.7,
              heightReference: HeightReference.NONE,
              alignedAxis: headingToEcefUnit(
                row.latitude,
                row.longitude,
                heading
              ),
              rotation: 0,
              disableDepthTestDistance: 500000,
              scaleByDistance: new NearFarScalar(0, 1.2, 5000000, 0.3)
            },
            description: `<b>${row.callsign || "N/A"}</b><br/>Country: ${
              row.origin_country
            }<br/>ICAO24: ${row.icao24}`
          });
          aircraft.set(row.icao24, {
            entity,
            lat: row.latitude,
            lon: row.longitude,
            alt,
            velocity: row.velocity ?? 0,
            heading
          });
        }
      }

      for (const [icao24, ac] of aircraft) {
        if (!seen.has(icao24)) {
          dataSource.entities.remove(ac.entity);
          aircraft.delete(icao24);
        }
      }
    } catch (e) {
      console.error("[LiveAircraft] poll failed:", e);
    }
  }

  function animate(timestamp) {
    const dtMs = timestamp - lastFrameTime;
    lastFrameTime = timestamp;

    if (dtMs > 0 && dtMs < 1000) {
      const dtSeconds = dtMs / 1000;
      for (const ac of aircraft.values()) {
        if (ac.velocity > 0 && ac.heading !== null) {
          const moved = extrapolate(
            ac.lat,
            ac.lon,
            ac.velocity,
            ac.heading,
            dtSeconds
          );
          ac.lat = moved.lat;
          ac.lon = moved.lon;
          ac.entity.position = Cartesian3.fromDegrees(
            moved.lon,
            moved.lat,
            ac.alt
          );
        }
      }
    }
    requestAnimationFrame(animate);
  }

  tryAttach();
}
