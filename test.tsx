import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react';

export type TipTapMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type TipTapNode = {
  type: string;
  content?: TipTapNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: TipTapMark[];
};

export type AnswerOption = {
  id: string;
  content: TipTapNode | string;
};

export type Question = {
  id: string;
  stem: TipTapNode | string;
  answers: AnswerOption[];
  explanation?: TipTapNode | string | null;
};

export type CheckStatus = 'idle' | 'checking' | 'success' | 'error';

export type CheckResult = {
  isCorrect: boolean;
  correctAnswerId: string;
  checkedAnswerId: string;
};

export type CheckError = {
  message: string;
  code?: string;
};

export type KatexRenderer = (latex: string, displayMode: boolean) => string;

type KaTeX = {
  renderToString: (
    latex: string,
    options: { displayMode: boolean; throwOnError: boolean }
  ) => string;
};

const getGlobalKatex = (): KaTeX | null => {
  const candidate = (globalThis as { katex?: KaTeX }).katex;
  if (!candidate || typeof candidate.renderToString !== 'function') {
    return null;
  }

  return candidate;
};

export const defaultKatexRenderer: KatexRenderer = (latex, displayMode) => {
  const katex = getGlobalKatex();
  if (!katex) {
    throw new Error('KaTeX is not available');
  }

  return katex.renderToString(latex, { displayMode, throwOnError: true });
};

export const renderMathToHtml = (
  latex: string,
  displayMode: boolean,
  renderer: KatexRenderer = defaultKatexRenderer
) => renderer(latex, displayMode);

export type RenderErrorBoundaryProps = {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error) => void;
};

type RenderErrorBoundaryState = {
  hasError: boolean;
};

export class RenderErrorBoundary extends React.Component<
  RenderErrorBoundaryProps,
  RenderErrorBoundaryState
> {
  state: RenderErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RenderErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }

    return this.props.children;
  }
}

export type TipTapRenderVariant = 'block' | 'inline';

export type TipTapRendererProps = {
  content: TipTapNode | string;
  onRenderError?: (error: Error) => void;
  katexRenderer?: KatexRenderer;
  variant?: TipTapRenderVariant;
};

const normalizeTipTapContent = (content: TipTapNode | string): TipTapNode => {
  if (typeof content === 'string') {
    return {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: content }]
        }
      ]
    };
  }

  return content;
};

const applyMarks = (marks: TipTapMark[] | undefined, node: React.ReactNode) => {
  if (!marks || marks.length === 0) {
    return node;
  }

  return marks.reduce((acc, mark) => {
    switch (mark.type) {
      case 'bold':
        return <strong>{acc}</strong>;
      case 'italic':
        return <em>{acc}</em>;
      case 'strike':
        return <s>{acc}</s>;
      case 'code':
        return <code>{acc}</code>;
      case 'link': {
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '#';
        const target = typeof mark.attrs?.target === 'string' ? mark.attrs.target : undefined;
        const rel = target === '_blank' ? 'noreferrer noopener' : undefined;
        return (
          <a href={href} target={target} rel={rel}>
            {acc}
          </a>
        );
      }
      default:
        return acc;
    }
  }, node as React.ReactNode);
};

const extractText = (node: TipTapNode): string => {
  if (typeof node.text === 'string') {
    return node.text;
  }

  if (!node.content) {
    return '';
  }

  return node.content.map(extractText).join('');
};

const getLatexFromNode = (node: TipTapNode): string => {
  if (typeof node.text === 'string') {
    return node.text;
  }

  if (typeof node.attrs?.latex === 'string') {
    return node.attrs.latex;
  }

  if (typeof node.attrs?.text === 'string') {
    return node.attrs.text;
  }

  return '';
};

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter((value): value is string => Boolean(value)).join(' ');

type MathNodeProps = {
  latex: string;
  displayMode: boolean;
  katexRenderer?: KatexRenderer;
};

const MathNode = ({ latex, displayMode, katexRenderer }: MathNodeProps) => {
  try {
    const html = renderMathToHtml(latex, displayMode, katexRenderer);
    return (
      <span
        className={displayMode ? 'math-display' : 'math-inline'}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  } catch (error) {
    return (
      <span className="math-fallback">
        {latex}
        <span className="math-warning"> (formula failed to render)</span>
      </span>
    );
  }
};

const renderNodes = (
  nodes: TipTapNode[] | undefined,
  onRenderError?: (error: Error) => void,
  katexRenderer?: KatexRenderer,
  variant: TipTapRenderVariant = 'block'
) =>
  nodes?.map((child, index) => renderNode(child, index, onRenderError, katexRenderer, variant)) ?? null;

const renderInlineList = (
  nodes: TipTapNode[] | undefined,
  onRenderError?: (error: Error) => void,
  katexRenderer?: KatexRenderer
) =>
  nodes?.map((child, index) => {
    const content =
      child.type === 'listItem'
        ? renderNodes(child.content, onRenderError, katexRenderer, 'inline')
        : renderNode(child, `list-item-${index}`, onRenderError, katexRenderer, 'inline');

    return (
      <React.Fragment key={index}>
        <span className="tiptap-inline-list-item">{content}</span>
        {index < (nodes?.length ?? 0) - 1 ? (
          <span className="tiptap-inline-sep">{' \u2022 '}</span>
        ) : null}
      </React.Fragment>
    );
  }) ?? null;

type RenderContext = {
  inline: boolean;
  variant: TipTapRenderVariant;
  onRenderError?: (error: Error) => void;
  katexRenderer?: KatexRenderer;
  renderNodes: (nodes: TipTapNode[] | undefined) => React.ReactNode;
  renderInlineList: (nodes: TipTapNode[] | undefined) => React.ReactNode;
};

type NodeRenderer = (node: TipTapNode, key: React.Key, ctx: RenderContext) => React.ReactNode;

type KnownNodeType =
  | 'doc'
  | 'paragraph'
  | 'heading'
  | 'text'
  | 'hardBreak'
  | 'bulletList'
  | 'orderedList'
  | 'listItem'
  | 'codeBlock'
  | 'blockquote'
  | 'horizontalRule'
  | 'image'
  | 'math_inline'
  | 'math_block';

const clampHeadingLevel = (level: number) => Math.min(Math.max(level, 1), 6);

const getHeadingTag = (level: number) =>
  `h${clampHeadingLevel(level)}` as keyof JSX.IntrinsicElements;

const renderInlineWrapper = (
  key: React.Key,
  className: string,
  content: React.ReactNode
) => (
  <span key={key} className={className}>
    {content}
  </span>
);

const renderBlockWrapper = <T extends keyof JSX.IntrinsicElements>(
  key: React.Key,
  Tag: T,
  content: React.ReactNode
) => <Tag key={key}>{content}</Tag>;

const nodeRenderers: Record<KnownNodeType, NodeRenderer> = {
  doc: (node, key, ctx) => (
    <React.Fragment key={key}>{ctx.renderNodes(node.content)}</React.Fragment>
  ),
  paragraph: (node, key, ctx) =>
    ctx.inline
      ? renderInlineWrapper(key, 'tiptap-inline-paragraph', ctx.renderNodes(node.content))
      : renderBlockWrapper(key, 'p', ctx.renderNodes(node.content)),
  heading: (node, key, ctx) => {
    const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 2;
    const Tag = getHeadingTag(level);
    return ctx.inline
      ? renderInlineWrapper(key, 'tiptap-inline-heading', ctx.renderNodes(node.content))
      : renderBlockWrapper(key, Tag, ctx.renderNodes(node.content));
  },
  text: (node, key) => (
    <React.Fragment key={key}>{applyMarks(node.marks, node.text ?? '')}</React.Fragment>
  ),
  hardBreak: (_node, key) => <br key={key} />,
  bulletList: (node, key, ctx) =>
    ctx.inline
      ? renderInlineWrapper(
          key,
          'tiptap-inline-list',
          ctx.renderInlineList(node.content)
        )
      : renderBlockWrapper(key, 'ul', ctx.renderNodes(node.content)),
  orderedList: (node, key, ctx) =>
    ctx.inline
      ? renderInlineWrapper(
          key,
          'tiptap-inline-list',
          ctx.renderInlineList(node.content)
        )
      : renderBlockWrapper(key, 'ol', ctx.renderNodes(node.content)),
  listItem: (node, key, ctx) =>
    ctx.inline
      ? renderInlineWrapper(key, 'tiptap-inline-list-item', ctx.renderNodes(node.content))
      : renderBlockWrapper(key, 'li', ctx.renderNodes(node.content)),
  codeBlock: (node, key, ctx) => {
    const codeText = node.text ?? extractText(node);
    return ctx.inline ? (
      <code key={key} className="tiptap-inline-code">
        {codeText}
      </code>
    ) : (
      <pre key={key}>
        <code>{codeText}</code>
      </pre>
    );
  },
  blockquote: (node, key, ctx) =>
    ctx.inline
      ? renderInlineWrapper(key, 'tiptap-inline-quote', ctx.renderNodes(node.content))
      : renderBlockWrapper(key, 'blockquote', ctx.renderNodes(node.content)),
  horizontalRule: (_node, key, ctx) => (ctx.inline ? null : <hr key={key} />),
  image: (node, key, ctx) => {
    const src = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
    const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
    if (!src) {
      ctx.onRenderError?.(new Error('Image node is missing src'));
      return null;
    }

    return <img key={key} src={src} alt={alt} loading="lazy" />;
  },
  math_inline: (node, key, ctx) => (
    <MathNode
      key={key}
      latex={getLatexFromNode(node)}
      displayMode={false}
      katexRenderer={ctx.katexRenderer}
    />
  ),
  math_block: (node, key, ctx) => (
    <div key={key} className="math-block">
      <MathNode latex={getLatexFromNode(node)} displayMode katexRenderer={ctx.katexRenderer} />
    </div>
  )
};

const renderNode = (
  node: TipTapNode,
  key: React.Key,
  onRenderError?: (error: Error) => void,
  katexRenderer?: KatexRenderer,
  variant: TipTapRenderVariant = 'block'
): React.ReactNode => {
  const context: RenderContext = {
    inline: variant === 'inline',
    variant,
    onRenderError,
    katexRenderer,
    renderNodes: (nodes) => renderNodes(nodes, onRenderError, katexRenderer, variant),
    renderInlineList: (nodes) => renderInlineList(nodes, onRenderError, katexRenderer)
  };

  const renderer = nodeRenderers[node.type as KnownNodeType];
  if (!renderer) {
    onRenderError?.(new Error(`Unsupported node type: ${node.type}`));
    return <span key={key} className="tiptap-unknown" data-node-type={node.type} />;
  }

  return renderer(node, key, context);
};

export const TipTapRenderer = ({
  content,
  onRenderError,
  katexRenderer,
  variant = 'block'
}: TipTapRendererProps) => {
  const node = normalizeTipTapContent(content);
  return <>{renderNode(node, 'root', onRenderError, katexRenderer, variant)}</>;
};

export type AppConfig = {
  demoMode: boolean;
  userEntitlement?: 'free' | 'pro' | 'enterprise';
};

const defaultConfig: AppConfig = {
  demoMode: false
};

const AppConfigContext = createContext<AppConfig>(defaultConfig);

export const AppConfigProvider = ({
  value,
  children
}: {
  value: AppConfig;
  children: React.ReactNode;
}) => <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;

export const useAppConfig = () => useContext(AppConfigContext);

const DEFAULT_DELAY_MS = 500;
const DEFAULT_FAIL_RATE = 0.15;

const resultCache = new Map<string, CheckResult>();
const correctAnswerByQuestion = new Map<string, string>();

const getCacheKey = (questionId: string, answerId: string) => `${questionId}::${answerId}`;

const abortError = () => {
  const error = new Error('Request aborted');
  (error as Error & { name: string }).name = 'AbortError';
  return error;
};

const getCorrectAnswerId = (questionId: string, answerId: string) => {
  if (!correctAnswerByQuestion.has(questionId)) {
    correctAnswerByQuestion.set(questionId, answerId);
  }

  return correctAnswerByQuestion.get(questionId) ?? answerId;
};

export type CheckAnswerOptions = {
  signal?: AbortSignal;
  delayMs?: number;
  failRate?: number;
  useCache?: boolean;
};

export const checkAnswer = (
  questionId: string,
  answerId: string,
  options: CheckAnswerOptions = {}
): Promise<CheckResult> => {
  const {
    signal,
    delayMs = DEFAULT_DELAY_MS,
    failRate = DEFAULT_FAIL_RATE,
    useCache = true
  } = options;

  const cacheKey = getCacheKey(questionId, answerId);
  const cached = useCache ? resultCache.get(cacheKey) : undefined;
  if (cached) {
    return Promise.resolve(cached);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }

      if (Math.random() < failRate) {
        reject(new Error('Network error. Please try again.'));
        return;
      }

      const correctAnswerId = getCorrectAnswerId(questionId, answerId);
      const result: CheckResult = {
        isCorrect: answerId === correctAnswerId,
        correctAnswerId,
        checkedAnswerId: answerId
      };

      if (useCache) {
        resultCache.set(cacheKey, result);
      }

      resolve(result);
    }, delayMs);

    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(abortError());
        },
        { once: true }
      );
    }
  });
};

export const InlineError = ({
  title = 'Something went wrong',
  message,
  actionLabel,
  onAction
}: {
  title?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) => (
  <div className="inline-error">
    <div className="inline-error__content">
      <strong className="inline-error__title">{title}</strong>
      <span className="inline-error__message">{message}</span>
    </div>
    {actionLabel && onAction ? (
      <button type="button" className="inline-error__action" onClick={onAction}>
        {actionLabel}
      </button>
    ) : null}
  </div>
);

export const QuestionSkeleton = () => (
  <div className="question-card question-card--loading">
    <div className="skeleton skeleton--stem" />
    <div className="skeleton skeleton--option" />
    <div className="skeleton skeleton--option" />
    <div className="skeleton skeleton--option" />
    <div className="skeleton skeleton--action" />
  </div>
);

export const QuestionStem = ({
  content,
  onRenderError,
  katexRenderer,
  boundaryKey
}: {
  content: TipTapNode | string;
  onRenderError?: (error: Error) => void;
  katexRenderer?: KatexRenderer;
  boundaryKey?: React.Key;
}) => (
  <RenderErrorBoundary
    key={boundaryKey}
    onError={onRenderError}
    fallback={<div className="question-stem__fallback">Content failed to render.</div>}
  >
    <div className="question-stem">
      <TipTapRenderer content={content} onRenderError={onRenderError} katexRenderer={katexRenderer} />
    </div>
  </RenderErrorBoundary>
);

export const AnswerOptions = ({
  options,
  selectedAnswerId,
  onSelect,
  disabled = false,
  revealCorrectness = false,
  correctAnswerId,
  onRenderError,
  katexRenderer
}: {
  options: AnswerOption[];
  selectedAnswerId: string | null;
  onSelect: (answerId: string) => void;
  disabled?: boolean;
  revealCorrectness?: boolean;
  correctAnswerId?: string;
  onRenderError?: (error: Error) => void;
  katexRenderer?: KatexRenderer;
}) => {
  return (
    <ul className="answer-options">
      {options.map((option) => {
        const isSelected = option.id === selectedAnswerId;
        const isCorrect = revealCorrectness && option.id === correctAnswerId;
        const isIncorrect = revealCorrectness && isSelected && !isCorrect;

        return (
          <li key={option.id} className="answer-options__item">
            <button
              type="button"
              disabled={disabled}
              className={cx(
                'answer-options__button',
                isSelected && 'is-selected',
                isCorrect && 'is-correct',
                isIncorrect && 'is-incorrect'
              )}
              onClick={() => onSelect(option.id)}
            >
              <span className="answer-options__marker" />
              <span className="answer-options__content">
                <TipTapRenderer
                  content={option.content}
                  onRenderError={onRenderError}
                  katexRenderer={katexRenderer}
                  variant="inline"
                />
              </span>
              {isCorrect ? (
                <span className="answer-options__status">Correct</span>
              ) : null}
              {isIncorrect ? (
                <span className="answer-options__status">Incorrect</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
};

export const ActionBar = ({
  onCheck,
  disabled,
  status,
  checkResult
}: {
  onCheck: () => void;
  disabled: boolean;
  status: CheckStatus;
  checkResult?: CheckResult | null;
}) => {
  const statusMessage =
    status === 'checking'
      ? 'Checking...'
      : status === 'success' && checkResult
        ? checkResult.isCorrect
          ? 'Correct answer.'
          : 'Answer is incorrect.'
        : status === 'error'
          ? 'Check failed. Try again.'
          : 'Select an answer to continue.';

  return (
    <div className="action-bar">
      <button
        type="button"
        className="action-bar__check"
        onClick={onCheck}
        disabled={disabled}
      >
        Check Answer
      </button>
      <span className="action-bar__status">{statusMessage}</span>
    </div>
  );
};

export const Explanation = ({
  content,
  visible,
  demoMode,
  onUpgradeClick,
  onRenderError,
  katexRenderer,
  boundaryKey
}: {
  content?: TipTapNode | string | null;
  visible: boolean;
  demoMode: boolean;
  onUpgradeClick?: () => void;
  onRenderError?: (error: Error) => void;
  katexRenderer?: KatexRenderer;
  boundaryKey?: React.Key;
}) => {
  if (!visible) {
    return null;
  }

  if (!content) {
    return <div className="explanation explanation--empty">Explanation is not available for this question.</div>;
  }

  const explanationContent = (
    <RenderErrorBoundary
      key={boundaryKey}
      onError={onRenderError}
      fallback={<div className="explanation__fallback">Explanation failed to render.</div>}
    >
      <TipTapRenderer content={content} onRenderError={onRenderError} katexRenderer={katexRenderer} />
    </RenderErrorBoundary>
  );

  if (demoMode) {
    return (
      <div className="explanation explanation--locked">
        <div className="explanation__blur">{explanationContent}</div>
        <div className="explanation__overlay">
          <div className="explanation__overlay-text">
            Explanation is available in the full version.
          </div>
          <button
            type="button"
            className="explanation__cta"
            onClick={onUpgradeClick}
          >
            Upgrade Access
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="explanation">
      {explanationContent}
    </div>
  );
};

export type QuestionCardProps = {
  question: Question | null;
  demoMode?: boolean;
  isLoading?: boolean;
  onUpgradeClick?: () => void;
  checkAnswer?: (
    questionId: string,
    answerId: string,
    options?: CheckAnswerOptions
  ) => Promise<CheckResult>;
  katexRenderer?: KatexRenderer;
};

const normalizeCheckError = (error: unknown): CheckError => {
  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: 'Check failed. Please try again.' };
};

export const QuestionCard = ({
  question,
  demoMode,
  isLoading = false,
  onUpgradeClick,
  checkAnswer: checkAnswerOverride,
  katexRenderer
}: QuestionCardProps) => {
  const { demoMode: contextDemoMode } = useAppConfig();
  const resolvedDemoMode = demoMode ?? contextDemoMode;
  const checkAnswerImpl = checkAnswerOverride ?? checkAnswer;

  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null);
  const [checkStatus, setCheckStatus] = useState<CheckStatus>('idle');
  const [checkError, setCheckError] = useState<CheckError | null>(null);
  const [renderError, setRenderError] = useState<Error | null>(null);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);

  const requestSeq = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const questionIdRef = useRef<string | null>(null);

  const resetState = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    requestSeq.current += 1;
    setSelectedAnswerId(null);
    setCheckStatus('idle');
    setCheckError(null);
    setRenderError(null);
    setCheckResult(null);
  }, []);

  useEffect(() => {
    if (!question?.id) {
      return;
    }

    if (questionIdRef.current !== question.id) {
      questionIdRef.current = question.id;
      resetState();
    }
  }, [question?.id, resetState]);

  useEffect(() => () => abortControllerRef.current?.abort(), []);

  const handleRenderError = useCallback((error: Error) => {
    setRenderError((prev) => prev ?? error);
  }, []);

  const handleSelectAnswer = useCallback(
    (answerId: string) => {
      if (checkStatus === 'checking') {
        return;
      }

      setSelectedAnswerId(answerId);
      if (checkStatus === 'success' || checkStatus === 'error') {
        setCheckStatus('idle');
        setCheckError(null);
        setCheckResult(null);
      }
    },
    [checkStatus]
  );

  const handleCheck = useCallback(() => {
    if (!question || !selectedAnswerId || checkStatus === 'checking') {
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = controller;

    const currentSeq = ++requestSeq.current;
    const questionId = question.id;
    const answerId = selectedAnswerId;

    setCheckStatus('checking');
    setCheckError(null);
    setCheckResult(null);

    checkAnswerImpl(questionId, answerId, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) {
          return;
        }

        if (requestSeq.current !== currentSeq) {
          return;
        }

        if (questionIdRef.current !== questionId) {
          return;
        }

        setCheckResult(result);
        setCheckStatus('success');
      })
      .catch((error) => {
        if ((error as Error & { name?: string }).name === 'AbortError') {
          return;
        }

        if (requestSeq.current !== currentSeq) {
          return;
        }

        setCheckStatus('error');
        setCheckError(normalizeCheckError(error));
      });
  }, [checkAnswerImpl, checkStatus, question, selectedAnswerId]);

  if (isLoading || !question) {
    return <QuestionSkeleton />;
  }

  const isCheckDisabled = !selectedAnswerId || checkStatus === 'checking';
  const showExplanation = checkStatus === 'success';
  const revealCorrectness = showExplanation && !!checkResult;

  return (
    <section className="question-card" data-question-id={question.id}>
      <QuestionStem
        content={question.stem}
        onRenderError={handleRenderError}
        katexRenderer={katexRenderer}
        boundaryKey={question.id}
      />

      {renderError ? (
        <InlineError
          title="Some content failed to render"
          message={renderError.message}
        />
      ) : null}

      <AnswerOptions
        options={question.answers}
        selectedAnswerId={selectedAnswerId}
        onSelect={handleSelectAnswer}
        disabled={checkStatus === 'checking'}
        revealCorrectness={revealCorrectness}
        correctAnswerId={checkResult?.correctAnswerId}
        onRenderError={handleRenderError}
        katexRenderer={katexRenderer}
      />

      <ActionBar
        onCheck={handleCheck}
        disabled={isCheckDisabled}
        status={checkStatus}
        checkResult={checkResult}
      />

      {checkStatus === 'error' && checkError ? (
        <InlineError
          title="Answer check failed"
          message={checkError.message}
          actionLabel="Retry"
          onAction={handleCheck}
        />
      ) : null}

      <Explanation
        content={question.explanation}
        visible={showExplanation}
        demoMode={resolvedDemoMode}
        onUpgradeClick={onUpgradeClick}
        onRenderError={handleRenderError}
        katexRenderer={katexRenderer}
        boundaryKey={question.id}
      />
    </section>
  );
};

export const questionCardStyles = `
:root {
  --qc-bg: linear-gradient(135deg, #f6f4ff 0%, #f9fbff 45%, #f2f8f6 100%);
  --qc-surface: #ffffff;
  --qc-border: #e4e8f0;
  --qc-text: #1b1f2a;
  --qc-muted: #5e6575;
  --qc-accent: #1a7f72;
  --qc-accent-strong: #0f5c52;
  --qc-error: #b42318;
  --qc-warning: #b54708;
  --qc-correct: #1a7f37;
  --qc-incorrect: #c01048;
  --qc-shadow: 0 12px 30px rgba(25, 31, 42, 0.1);
}

.question-card {
  background: var(--qc-bg);
  color: var(--qc-text);
  border-radius: 18px;
  border: 1px solid var(--qc-border);
  padding: 24px;
  max-width: 720px;
  margin: 0 auto;
  box-shadow: var(--qc-shadow);
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
  line-height: 1.6;
}

.question-card--loading {
  min-height: 320px;
}

.question-stem {
  margin-bottom: 20px;
  overflow-wrap: anywhere;
}

.question-stem p:first-child {
  margin-top: 0;
}

.question-stem p:last-child {
  margin-bottom: 0;
}

.question-stem__fallback,
.explanation__fallback {
  padding: 12px 14px;
  border: 1px dashed var(--qc-border);
  border-radius: 12px;
  color: var(--qc-warning);
  background: rgba(255, 241, 229, 0.6);
}

.math-inline,
.math-display {
  font-family: "STIX Two Math", "Cambria Math", serif;
}

.math-block {
  margin: 12px 0;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 12px;
}

.math-fallback {
  background: rgba(0, 0, 0, 0.06);
  padding: 2px 6px;
  border-radius: 6px;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}

.math-warning {
  color: var(--qc-warning);
  font-size: 0.85em;
  margin-left: 4px;
}

.tiptap-inline-paragraph,
.tiptap-inline-heading,
.tiptap-inline-list,
.tiptap-inline-list-item,
.tiptap-inline-quote {
  display: inline;
}

.tiptap-inline-sep {
  color: var(--qc-muted);
}

.tiptap-inline-code {
  background: rgba(0, 0, 0, 0.06);
  padding: 2px 6px;
  border-radius: 6px;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}

.answer-options {
  display: grid;
  gap: 12px;
  padding: 0;
  margin: 0 0 18px 0;
  list-style: none;
}

.answer-options__item {
  margin: 0;
}

.answer-options__button {
  width: 100%;
  text-align: left;
  border-radius: 14px;
  border: 1px solid var(--qc-border);
  padding: 14px 16px;
  background: var(--qc-surface);
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 12px;
  align-items: center;
  transition: transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
}

.answer-options__button:hover {
  border-color: rgba(26, 127, 114, 0.5);
  transform: translateY(-1px);
}

.answer-options__button:focus-visible {
  outline: 3px solid rgba(26, 127, 114, 0.3);
  outline-offset: 2px;
}

.answer-options__button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

.answer-options__marker {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--qc-muted);
  position: relative;
}

.answer-options__button.is-selected .answer-options__marker {
  border-color: var(--qc-accent);
}

.answer-options__button.is-selected .answer-options__marker::after {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--qc-accent);
  position: absolute;
  top: 2px;
  left: 2px;
}

.answer-options__button.is-correct {
  border-color: rgba(26, 127, 55, 0.5);
  box-shadow: 0 0 0 1px rgba(26, 127, 55, 0.15);
}

.answer-options__button.is-incorrect {
  border-color: rgba(192, 16, 72, 0.5);
  box-shadow: 0 0 0 1px rgba(192, 16, 72, 0.15);
}

.answer-options__status {
  font-size: 0.85rem;
  color: var(--qc-muted);
}

.action-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
}

.action-bar__check {
  background: var(--qc-accent);
  color: #ffffff;
  border: none;
  border-radius: 12px;
  padding: 10px 18px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 120ms ease, background 120ms ease;
}

.action-bar__check:hover:not(:disabled) {
  background: var(--qc-accent-strong);
  transform: translateY(-1px);
}

.action-bar__check:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-bar__status {
  color: var(--qc-muted);
  font-size: 0.95rem;
}

.inline-error {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(180, 35, 24, 0.3);
  background: rgba(254, 231, 226, 0.75);
  color: var(--qc-error);
  margin-bottom: 16px;
}

.inline-error__content {
  display: grid;
  gap: 4px;
}

.inline-error__action {
  background: transparent;
  border: 1px solid rgba(180, 35, 24, 0.4);
  color: var(--qc-error);
  border-radius: 10px;
  padding: 6px 12px;
  cursor: pointer;
}

.explanation {
  border-radius: 14px;
  border: 1px solid var(--qc-border);
  padding: 16px;
  background: var(--qc-surface);
}

.explanation--empty {
  color: var(--qc-muted);
}

.explanation--locked {
  position: relative;
  overflow: hidden;
}

.explanation__blur {
  filter: blur(6px);
  transform: scale(1.02);
  pointer-events: none;
  user-select: none;
}

.explanation__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 12px;
  background: rgba(255, 255, 255, 0.8);
  text-align: center;
  padding: 20px;
}

.explanation__cta {
  background: var(--qc-accent);
  color: #ffffff;
  border: none;
  border-radius: 10px;
  padding: 8px 14px;
  font-weight: 600;
  cursor: pointer;
}

.skeleton {
  background: linear-gradient(90deg, #e6eaf1 0%, #f3f6fb 50%, #e6eaf1 100%);
  border-radius: 10px;
  animation: skeleton-pulse 1.2s ease-in-out infinite;
}

.skeleton--stem {
  height: 72px;
  margin-bottom: 18px;
}

.skeleton--option {
  height: 52px;
  margin-bottom: 12px;
}

.skeleton--action {
  height: 40px;
  width: 180px;
}

@keyframes skeleton-pulse {
  0% {
    background-position: 0% 50%;
  }
  100% {
    background-position: 100% 50%;
  }
}

@media (max-width: 640px) {
  .question-card {
    padding: 18px;
    border-radius: 16px;
  }

  .action-bar {
    flex-direction: column;
    align-items: flex-start;
  }

  .answer-options__button {
    grid-template-columns: auto 1fr;
  }

  .answer-options__status {
    grid-column: 2 / 3;
  }
}
`;

export const QuestionCardStyles = () => <style>{questionCardStyles}</style>;
