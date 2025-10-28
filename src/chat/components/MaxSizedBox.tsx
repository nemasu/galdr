import React, { Fragment, useEffect, useId } from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { useOverflowActions } from '../contexts/OverflowContext.js';

export const MINIMUM_MAX_HEIGHT = 2;

// Helper to convert string to code points (handles Unicode properly)
function toCodePoints(str: string): string[] {
  return Array.from(str);
}

interface MaxSizedBoxProps {
  children?: React.ReactNode;
  maxWidth?: number;
  maxHeight: number | undefined;
  overflowDirection?: 'top' | 'bottom';
  additionalHiddenLinesCount?: number;
}

interface StyledText {
  text: string;
  props: Record<string, unknown>;
}

interface Row {
  noWrapSegments: StyledText[];
  segments: StyledText[];
}

/**
 * A component that constrains content size and provides content-aware truncation.
 *
 * Children must follow this structure:
 * - Direct children must be <Box> elements (each represents a row)
 * - Row <Box> elements must contain only <Text> elements
 * - Non-wrapping <Text> must come before wrapping <Text> in the same row
 */
export const MaxSizedBox: React.FC<MaxSizedBoxProps> = ({
  children,
  maxWidth,
  maxHeight,
  overflowDirection = 'top',
  additionalHiddenLinesCount = 0,
}) => {
  const id = useId();
  const { addOverflowingId, removeOverflowingId } = useOverflowActions() || {};

  const laidOutStyledText: StyledText[][] = [];
  const targetMaxHeight = Math.max(
    Math.round(maxHeight ?? Number.MAX_SAFE_INTEGER),
    MINIMUM_MAX_HEIGHT
  );

  if (maxWidth === undefined) {
    throw new Error('maxWidth must be defined when maxHeight is set.');
  }

  function visitRows(element: React.ReactNode) {
    if (!React.isValidElement<{ children?: React.ReactNode }>(element)) {
      return;
    }

    if (element.type === Fragment) {
      React.Children.forEach(element.props.children, visitRows);
      return;
    }

    if (element.type === Box) {
      layoutInkElementAsStyledText(element, maxWidth!, laidOutStyledText);
      return;
    }
  }

  React.Children.forEach(children, visitRows);

  const contentWillOverflow =
    (targetMaxHeight !== undefined && laidOutStyledText.length > targetMaxHeight) ||
    additionalHiddenLinesCount > 0;

  const visibleContentHeight =
    contentWillOverflow && targetMaxHeight !== undefined
      ? targetMaxHeight - 1
      : targetMaxHeight;

  const hiddenLinesCount =
    visibleContentHeight !== undefined
      ? Math.max(0, laidOutStyledText.length - visibleContentHeight)
      : 0;
  const totalHiddenLines = hiddenLinesCount + additionalHiddenLinesCount;

  useEffect(() => {
    if (totalHiddenLines > 0) {
      addOverflowingId?.(id);
    } else {
      removeOverflowingId?.(id);
    }
    return () => {
      removeOverflowingId?.(id);
    };
  }, [id, totalHiddenLines, addOverflowingId, removeOverflowingId]);

  const visibleStyledText =
    hiddenLinesCount > 0
      ? overflowDirection === 'top'
        ? laidOutStyledText.slice(hiddenLinesCount, laidOutStyledText.length)
        : laidOutStyledText.slice(0, visibleContentHeight)
      : laidOutStyledText;

  const visibleLines = visibleStyledText.map((line, index) => (
    <Box key={index}>
      {line.length > 0 ? (
        line.map((segment, segIndex) => (
          <Text key={segIndex} {...segment.props}>
            {segment.text}
          </Text>
        ))
      ) : (
        <Text> </Text>
      )}
    </Box>
  ));

  return (
    <Box flexDirection="column" width={maxWidth} flexShrink={0}>
      {totalHiddenLines > 0 && overflowDirection === 'top' && (
        <Text dimColor wrap="truncate">
          ... first {totalHiddenLines} line{totalHiddenLines === 1 ? '' : 's'} hidden ...
        </Text>
      )}
      {visibleLines}
      {totalHiddenLines > 0 && overflowDirection === 'bottom' && (
        <Text dimColor wrap="truncate">
          ... last {totalHiddenLines} line{totalHiddenLines === 1 ? '' : 's'} hidden ...
        </Text>
      )}
    </Box>
  );
};

function visitBoxRow(element: React.ReactNode): Row {
  if (
    !React.isValidElement<{ children?: React.ReactNode }>(element) ||
    element.type !== Box
  ) {
    return { noWrapSegments: [{ text: '<ERROR>', props: {} }], segments: [] };
  }

  const row: Row = { noWrapSegments: [], segments: [] };
  let hasSeenWrapped = false;

  function visitRowChild(
    element: React.ReactNode,
    parentProps: Record<string, unknown> | undefined
  ) {
    if (element === null) return;

    if (typeof element === 'string' || typeof element === 'number') {
      const text = String(element);
      if (!text) return;

      const segment: StyledText = { text, props: parentProps ?? {} };

      if (parentProps === undefined || parentProps['wrap'] === 'wrap') {
        hasSeenWrapped = true;
        row.segments.push(segment);
      } else {
        if (!hasSeenWrapped) {
          row.noWrapSegments.push(segment);
        } else {
          row.segments.push(segment);
        }
      }
      return;
    }

    if (!React.isValidElement<{ children?: React.ReactNode }>(element)) return;

    if (element.type === Fragment) {
      React.Children.forEach(element.props.children, (child) =>
        visitRowChild(child, parentProps)
      );
      return;
    }

    if (element.type !== Text) return;

    const { children, ...currentProps } = element.props;
    const mergedProps =
      parentProps === undefined ? currentProps : { ...parentProps, ...currentProps };
    React.Children.forEach(children, (child) => visitRowChild(child, mergedProps));
  }

  React.Children.forEach(element.props.children, (child) =>
    visitRowChild(child, undefined)
  );

  return row;
}

function layoutInkElementAsStyledText(
  element: React.ReactElement,
  maxWidth: number,
  output: StyledText[][]
) {
  const row = visitBoxRow(element);
  if (row.segments.length === 0 && row.noWrapSegments.length === 0) {
    output.push([]);
    return;
  }

  const lines: StyledText[][] = [];
  const nonWrappingContent: StyledText[] = [];
  let noWrappingWidth = 0;

  row.noWrapSegments.forEach((segment) => {
    nonWrappingContent.push(segment);
    noWrappingWidth += stringWidth(segment.text);
  });

  if (row.segments.length === 0) {
    const lines: StyledText[][] = [];
    let currentLine: StyledText[] = [];
    nonWrappingContent.forEach((segment) => {
      const textLines = segment.text.split('\n');
      textLines.forEach((text, index) => {
        if (index > 0) {
          lines.push(currentLine);
          currentLine = [];
        }
        if (text) {
          currentLine.push({ text, props: segment.props });
        }
      });
    });
    if (
      currentLine.length > 0 ||
      (nonWrappingContent.length > 0 &&
        nonWrappingContent[nonWrappingContent.length - 1].text.endsWith('\n'))
    ) {
      lines.push(currentLine);
    }
    for (const line of lines) {
      output.push(line);
    }
    return;
  }

  const availableWidth = maxWidth - noWrappingWidth;

  if (availableWidth < 1) {
    const lines: StyledText[][] = [];
    let currentLine: StyledText[] = [];
    let currentLineWidth = 0;

    for (const segment of nonWrappingContent) {
      const textLines = segment.text.split('\n');
      textLines.forEach((text, index) => {
        if (index > 0) {
          lines.push(currentLine);
          currentLine = [];
          currentLineWidth = 0;
        }

        if (text) {
          const textWidth = stringWidth(text);
          if (index > 0 && textWidth > 0) {
            currentLine.push({ text: '…', props: {} });
            currentLineWidth = stringWidth('…');
          } else {
            const maxContentWidth = Math.max(0, maxWidth - stringWidth('…'));
            if (textWidth <= maxContentWidth && currentLineWidth === 0) {
              currentLine.push({ text, props: segment.props });
              currentLineWidth += textWidth;
            } else {
              const codePoints = toCodePoints(text);
              let truncatedWidth = currentLineWidth;
              let sliceEndIndex = 0;

              for (const char of codePoints) {
                const charWidth = stringWidth(char);
                if (truncatedWidth + charWidth > maxContentWidth) break;
                truncatedWidth += charWidth;
                sliceEndIndex++;
              }

              const slice = codePoints.slice(0, sliceEndIndex).join('');
              if (slice) {
                currentLine.push({ text: slice, props: segment.props });
              }
              currentLine.push({ text: '…', props: {} });
              currentLineWidth = truncatedWidth + stringWidth('…');
            }
          }
        }
      });
    }

    if (
      currentLine.length > 0 ||
      (nonWrappingContent.length > 0 &&
        nonWrappingContent[nonWrappingContent.length - 1].text.endsWith('\n'))
    ) {
      lines.push(currentLine);
    }

    if (lines.length === 0) {
      lines.push([{ text: '…', props: {} }]);
    }

    for (const line of lines) {
      output.push(line);
    }
    return;
  }

  let wrappingPart: StyledText[] = [];
  let wrappingPartWidth = 0;

  function addWrappingPartToLines() {
    if (lines.length === 0) {
      lines.push([...nonWrappingContent, ...wrappingPart]);
    } else {
      if (noWrappingWidth > 0) {
        lines.push([
          { text: ' '.repeat(noWrappingWidth), props: {} },
          ...wrappingPart,
        ]);
      } else {
        lines.push(wrappingPart);
      }
    }
    wrappingPart = [];
    wrappingPartWidth = 0;
  }

  function addToWrappingPart(text: string, props: Record<string, unknown>) {
    if (
      wrappingPart.length > 0 &&
      wrappingPart[wrappingPart.length - 1].props === props
    ) {
      wrappingPart[wrappingPart.length - 1].text += text;
    } else {
      wrappingPart.push({ text, props });
    }
  }

  row.segments.forEach((segment) => {
    const linesFromSegment = segment.text.split('\n');

    linesFromSegment.forEach((lineText, lineIndex) => {
      if (lineIndex > 0) {
        addWrappingPartToLines();
      }

      const words = lineText.split(/(\s+)/);

      words.forEach((word) => {
        if (!word) return;
        const wordWidth = stringWidth(word);

        if (wrappingPartWidth + wordWidth > availableWidth && wrappingPartWidth > 0) {
          addWrappingPartToLines();
          if (/^\s+$/.test(word)) return;
        }

        if (wordWidth > availableWidth) {
          const wordAsCodePoints = toCodePoints(word);
          let remainingWordAsCodePoints = wordAsCodePoints;
          while (remainingWordAsCodePoints.length > 0) {
            let splitIndex = 0;
            let currentSplitWidth = 0;
            for (const char of remainingWordAsCodePoints) {
              const charWidth = stringWidth(char);
              if (wrappingPartWidth + currentSplitWidth + charWidth > availableWidth) {
                break;
              }
              currentSplitWidth += charWidth;
              splitIndex++;
            }

            if (splitIndex > 0) {
              const part = remainingWordAsCodePoints.slice(0, splitIndex).join('');
              addToWrappingPart(part, segment.props);
              wrappingPartWidth += stringWidth(part);
              remainingWordAsCodePoints = remainingWordAsCodePoints.slice(splitIndex);
            }

            if (remainingWordAsCodePoints.length > 0) {
              addWrappingPartToLines();
            }
          }
        } else {
          addToWrappingPart(word, segment.props);
          wrappingPartWidth += wordWidth;
        }
      });
    });

    if (segment.text.endsWith('\n')) {
      addWrappingPartToLines();
    }
  });

  if (wrappingPart.length > 0) {
    addWrappingPartToLines();
  }
  for (const line of lines) {
    output.push(line);
  }
}
