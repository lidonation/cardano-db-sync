import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useThemeConfig} from '@docusaurus/theme-common';
import {CodeBlockContextProvider, createCodeBlockMetadata} from '@docusaurus/theme-common/internal';
import CodeBlockLayout from '@theme/CodeBlock/Layout';
import type {Props} from '@theme/CodeBlock/Content/String';

/** The classic hook writes inline styles when toggling wrap, which SEC-2 blocks. */
function useCspWordWrap() {
  const codeBlockRef = useRef<HTMLPreElement>(null);
  const [isEnabled, setEnabled] = useState(false);
  const [isCodeScrollable, setScrollable] = useState(false);
  const toggle = useCallback(() => setEnabled((value) => !value), []);
  const measure = useCallback(() => {
    const element = codeBlockRef.current;
    if (element) setScrollable(element.scrollWidth > element.clientWidth);
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure, {passive: true});
    const element = codeBlockRef.current;
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (element) resize?.observe(element);
    const panel = element?.closest('[role=tabpanel]');
    const visibility = panel ? new MutationObserver(measure) : null;
    if (panel) visibility?.observe(panel, {attributes: true, attributeFilter: ['hidden']});
    return () => {
      window.removeEventListener('resize', measure);
      resize?.disconnect();
      visibility?.disconnect();
    };
  }, [measure]);
  useEffect(() => measure(), [isEnabled, measure]);
  return {codeBlockRef, isEnabled, isCodeScrollable, toggle};
}

export default function CodeBlockString(props: Props): React.JSX.Element {
  const {prism} = useThemeConfig();
  const metadata = createCodeBlockMetadata({
    code: props.children,
    className: props.className,
    metastring: props.metastring,
    magicComments: prism.magicComments,
    defaultLanguage: prism.defaultLanguage,
    language: props.language,
    title: props.title,
    showLineNumbers: props.showLineNumbers,
  });
  const wordWrap = useCspWordWrap();
  return (
    <CodeBlockContextProvider metadata={metadata} wordWrap={wordWrap}>
      <CodeBlockLayout />
    </CodeBlockContextProvider>
  );
}
