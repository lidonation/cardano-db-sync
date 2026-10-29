import React from 'react';
import clsx from 'clsx';
import {Highlight, type PrismTheme} from 'prism-react-renderer';
import {useCodeBlockContext} from '@docusaurus/theme-common/internal';
import type {Props} from '@theme/CodeBlock/Content';
import styles from './styles.module.css';

// Prism still supplies token classes, but a blank theme never injects inline styles.
const classOnlyTheme: PrismTheme = {plain: {}, styles: []};

export default function CodeBlockContent({className}: Props): React.JSX.Element {
  const {metadata, wordWrap} = useCodeBlockContext();
  const {code, language, lineNumbersStart, lineClassNames} = metadata;
  return (
    <Highlight theme={classOnlyTheme} code={code} language={language}>
      {({className: languageClass, tokens, getTokenProps}) => (
        <pre
          ref={wordWrap.codeBlockRef}
          tabIndex={0}
          className={clsx(className, languageClass, styles.pre, 'thin-scrollbar')}
        >
          <code className={styles.code} data-wrap={wordWrap.isEnabled ? 'true' : undefined}>
            {tokens.map((line, index) => (
              <span key={index} className={clsx(styles.line, lineClassNames[index])}>
                {lineNumbersStart !== undefined && (
                  <span
                    aria-hidden="true"
                    className={styles.number}
                    data-line={lineNumbersStart + index}
                  />
                )}
                {line.map((token, key) => {
                  const {style, ...props} = getTokenProps({token});
                  void style;
                  // Prism represents an empty line as a newline token; the line break below owns it.
                  return (
                    <span key={key} {...props}>
                      {token.content === '\n' ? '' : token.content}
                    </span>
                  );
                })}
                {'\n'}
              </span>
            ))}
          </code>
        </pre>
      )}
    </Highlight>
  );
}
