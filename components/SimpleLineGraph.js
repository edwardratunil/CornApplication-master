import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { moderateScale } from '../utils/responsive';
import { Dimensions } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function SimpleLineGraph({ data = [], color = '#AAAAAA', labels = [], minWidth = null }) {
  const { points, graphHeight, graphWidth } = useMemo(() => {
    if (!data.length) {
      return {
        points: [],
        graphHeight: moderateScale(80),
        graphWidth: minWidth || SCREEN_WIDTH - moderateScale(80),
      };
    }

    const graphHeight = moderateScale(80);
    // Calculate width: at least screen width, or wider if we have many data points
    const calculatedWidth = Math.max(
      SCREEN_WIDTH - moderateScale(80),
      data.length * moderateScale(50) // 50px per data point for better spacing
    );
    const graphWidth = minWidth || calculatedWidth;

    const maxValue = Math.max(...data);
    const minValue = Math.min(...data);
    const range = maxValue - minValue || 1;

    const normalizedData = data.map((value) => {
      if (isNaN(value)) {
        return 50;
      }
      return range > 0 ? ((value - minValue) / range) * 100 : 50;
    });

    const points = normalizedData.map((point, index) => {
      const x = (index / (normalizedData.length - 1 || 1)) * graphWidth;
      const y = graphHeight - (point / 100) * graphHeight;
      return { x, y };
    });

    return { points, graphHeight, graphWidth };
  }, [data]);

  const displayLabels = labels.length ? labels : data.map((_, index) => `${index + 1}`);

  return (
    <View style={styles.graphContainer}>
      <View style={[styles.graph, { height: graphHeight, width: graphWidth }]}>
        {points.map((point, index) => {
          if (index === points.length - 1) return null;
          const nextPoint = points[index + 1];
          const dx = nextPoint.x - point.x;
          const dy = nextPoint.y - point.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);

          return (
            <View
              key={`line-${index}`}
              style={[
                styles.graphLine,
                {
                  left: point.x,
                  top: point.y,
                  width: length,
                  transform: [{ rotate: `${angle}deg` }],
                  backgroundColor: color,
                },
              ]}
            />
          );
        })}
        {points.map((point, index) => (
          <View
            key={`point-${index}`}
            style={[
              styles.graphPoint,
              {
                left: point.x - moderateScale(2),
                top: point.y - moderateScale(2),
                backgroundColor: color,
              },
            ]}
          />
        ))}
      </View>
      <View style={styles.labelRow}>
        {displayLabels.map((label, index) => (
          <Text key={`label-${index}`} style={styles.dayLabel}>
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  graphContainer: {
    marginTop: moderateScale(8),
  },
  graph: {
    position: 'relative',
    marginBottom: moderateScale(8),
    overflow: 'hidden',
  },
  graphPoint: {
    position: 'absolute',
    width: moderateScale(4),
    height: moderateScale(4),
    borderRadius: moderateScale(2),
  },
  graphLine: {
    position: 'absolute',
    height: moderateScale(2),
    opacity: 0.8,
    transformOrigin: 'left center',
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: moderateScale(4),
  },
  dayLabel: {
    flex: 1,
    textAlign: 'center',
    color: '#AAAAAA',
    fontSize: moderateScale(10),
  },
});

