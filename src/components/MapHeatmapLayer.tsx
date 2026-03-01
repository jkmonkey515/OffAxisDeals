/**
 * Heatmap layer for react-native-maps. Only ever loaded when not on iOS Apple Maps.
 * This file imports Heatmap from react-native-maps (Google-only on iOS); do not
 * require this module on iOS when using Apple Maps to avoid native errors.
 */
import React from 'react';
import { Heatmap } from 'react-native-maps';

export interface MapHeatmapLayerProps {
  points: Array<{ latitude: number; longitude: number; weight: number }>;
  radius?: number;
  opacity?: number;
  maxIntensity?: number;
}

export default function MapHeatmapLayer({
  points,
  radius = 40,
  opacity = 0.7,
  maxIntensity: _maxIntensity,
}: MapHeatmapLayerProps) {
  if (points.length === 0) return null;
  return (
    <Heatmap points={points} radius={radius} opacity={opacity} />
  );
}
