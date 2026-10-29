
const express = require("express");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

const http = axios.create({
  timeout: 15000,
  headers: { Accept: "application/json" }
});

// Middleware
app.use(cors());
app.use(express.json());

// Weather code descriptions from Open-Meteo
function getWeatherDescription(code) {
  const descriptions = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snowfall",
    73: "Moderate snowfall",
    75: "Heavy snowfall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail"
  };

  return descriptions[code] || "Unknown weather conditions";
}

// API health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "ZILLA-WEATHER API is running",
    timestamp: new Date().toISOString()
  });
});

// Root route
app.get("/", (req, res) => {
  res.json({
    name: "ZILLA-WEATHER API",
    status: "running",
    endpoints: [
      "/api/health",
      "/api/locations?city=Kigali",
      "/api/weather?city=Kigali",
      "/api/weather?city=Kigali&days=7"
    ]
  });
});

// Search for cities
app.get("/api/locations", async (req, res) => {
  try {
    const city = String(req.query.city || "").trim();

    if (city.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Enter a city name containing at least 2 characters."
      });
    }

    const response = await http.get(
      "https://geocoding-api.open-meteo.com/v1/search",
      {
        params: {
          name: city,
          count: 5,
          language: "en",
          format: "json"
        }
      }
    );

    const locations = (response.data.results || []).map((place) => ({
      id: place.id,
      name: place.name,
      country: place.country || "",
      region: place.admin1 || "",
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: place.timezone || "auto"
    }));

    res.json({
      success: true,
      count: locations.length,
      locations
    });
  } catch (error) {
    console.error("Location search error:", error.message);

    res.status(502).json({
      success: false,
      message: "Unable to search locations right now."
    });
  }
});

// Get current weather and forecasts
app.get("/api/weather", async (req, res) => {
  try {
    const city = String(req.query.city || "Kigali").trim();
    const requestedDays = Number.parseInt(req.query.days || "7", 10);

    if (!city || city.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid city name."
      });
    }

    if (
      !Number.isInteger(requestedDays) ||
      requestedDays < 1 ||
      requestedDays > 7
    ) {
      return res.status(400).json({
        success: false,
        message: "The days parameter must be a number from 1 to 7."
      });
    }

    // Step 1: Convert city name into coordinates
    const geoResponse = await http.get(
      "https://geocoding-api.open-meteo.com/v1/search",
      {
        params: {
          name: city,
          count: 1,
          language: "en",
          format: "json"
        }
      }
    );

    const place = geoResponse.data.results?.[0];

    if (!place) {
      return res.status(404).json({
        success: false,
        message: `No location found for "${city}". Try another city name.`
      });
    }

    // Step 2: Fetch current, hourly and daily weather
    const weatherResponse = await http.get(
      "https://api.open-meteo.com/v1/forecast",
      {
        params: {
          latitude: place.latitude,
          longitude: place.longitude,
          timezone: "auto",
          forecast_days: requestedDays,

          current: [
            "temperature_2m",
            "relative_humidity_2m",
            "apparent_temperature",
            "is_day",
            "precipitation",
            "rain",
            "weather_code",
            "cloud_cover",
            "pressure_msl",
            "wind_speed_10m",
            "wind_direction_10m"
          ].join(","),

          hourly: [
            "temperature_2m",
            "relative_humidity_2m",
            "apparent_temperature",
            "precipitation_probability",
            "precipitation",
            "weather_code",
            "wind_speed_10m",
            "uv_index"
          ].join(","),

          daily: [
            "weather_code",
            "temperature_2m_max",
            "temperature_2m_min",
            "apparent_temperature_max",
            "apparent_temperature_min",
            "sunrise",
            "sunset",
            "daylight_duration",
            "uv_index_max",
            "precipitation_sum",
            "precipitation_probability_max",
            "wind_speed_10m_max"
          ].join(",")
        }
      }
    );

    const data = weatherResponse.data;
    const current = data.current;
    const hourly = data.hourly;
    const daily = data.daily;

    // Step 3: Return clean data for the React frontend
    const currentWeather = {
      time: current.time,
      temperature: current.temperature_2m,
      feelsLike: current.apparent_temperature,
      humidity: current.relative_humidity_2m,
      isDay: current.is_day === 1,
      precipitation: current.precipitation,
      rain: current.rain,
      condition: getWeatherDescription(current.weather_code),
      weatherCode: current.weather_code,
      cloudCover: current.cloud_cover,
      pressure: current.pressure_msl,
      windSpeed: current.wind_speed_10m,
      windDirection: current.wind_direction_10m,
      units: {
        temperature: data.current_units.temperature_2m,
        windSpeed: data.current_units.wind_speed_10m,
        pressure: data.current_units.pressure_msl,
        humidity: "%"
      }
    };

    const hourlyForecast = hourly.time.map((time, index) => ({
      time,
      temperature: hourly.temperature_2m[index],
      humidity: hourly.relative_humidity_2m[index],
      feelsLike: hourly.apparent_temperature[index],
      precipitationProbability:
        hourly.precipitation_probability[index],
      precipitation: hourly.precipitation[index],
      condition: getWeatherDescription(hourly.weather_code[index]),
      weatherCode: hourly.weather_code[index],
      windSpeed: hourly.wind_speed_10m[index],
      uvIndex: hourly.uv_index[index]
    }));

    const dailyForecast = daily.time.map((date, index) => ({
      date,
      condition: getWeatherDescription(daily.weather_code[index]),
      weatherCode: daily.weather_code[index],
      maxTemperature: daily.temperature_2m_max[index],
      minTemperature: daily.temperature_2m_min[index],
      feelsLikeMax: daily.apparent_temperature_max[index],
      feelsLikeMin: daily.apparent_temperature_min[index],
      sunrise: daily.sunrise[index],
      sunset: daily.sunset[index],
      daylightDurationSeconds: daily.daylight_duration[index],
      uvIndexMax: daily.uv_index_max[index],
      precipitationSum: daily.precipitation_sum[index],
      precipitationProbability:
        daily.precipitation_probability_max[index],
      maxWindSpeed: daily.wind_speed_10m_max[index]
    }));

    res.json({
      success: true,
      source: "Open-Meteo",
      location: {
        name: place.name,
        country: place.country || "",
        region: place.admin1 || "",
        latitude: place.latitude,
        longitude: place.longitude,
        timezone: data.timezone
      },
      current: currentWeather,
      hourly: hourlyForecast,
      daily: dailyForecast,
      units: {
        temperature: data.current_units.temperature_2m,
        windSpeed: data.current_units.wind_speed_10m,
        precipitation: data.hourly_units.precipitation,
        uvIndex: "UV index",
        pressure: data.current_units.pressure_msl
      }
    });
  } catch (error) {
    console.error(
      "Weather API error:",
      error.response?.data || error.message
    );

    res.status(502).json({
      success: false,
      message: "Unable to retrieve weather data. Check your internet connection and try again."
    });
  }
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
});

// Start server
app.listen(PORT, () => {
  console.log("-----------------------------------");
  console.log("   ZILLA-WEATHER API");
  console.log(`   Running on http://localhost:${PORT}`);
  console.log("-----------------------------------");
});
