import { useEffect, useState, useRef } from 'react'

const TURQUOISE = '#0cb7ae'
const CLOSE_OFFSET = 34
const LOGO_INITIAL_SIZE = 50
const LOGO_FINAL_SIZE = 40
const WORDMARK_GAP = 4
const TOTAL_FRAMES = 62
const DURATION = 2800

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const easeOutQuad = (t: number) => 1 - Math.pow(1 - t, 2)

const WORDMARK_PATH =
  'M 651 469 L 642 483 L 634 508 L 633 608 L 665 608 L 666 567 L 769 567 L 770 608 L 802 608 L 802 451 L 796 442 L 788 439 L 703 440 L 684 445 L 672 451 L 662 458 Z ' +
  'M 111 469 L 102 483 L 94 508 L 93 608 L 125 608 L 126 567 L 229 567 L 230 608 L 262 608 L 262 451 L 256 442 L 248 439 L 163 440 L 144 445 L 132 451 L 122 458 Z ' +
  'M 842 451 L 834 460 L 829 469 L 826 481 L 826 498 L 829 510 L 833 518 L 844 530 L 857 537 L 870 540 L 949 540 L 957 544 L 961 549 L 963 555 L 963 562 L 960 569 L 951 576 L 828 576 L 827 608 L 953 608 L 967 604 L 977 598 L 988 586 L 993 574 L 995 563 L 995 553 L 992 539 L 987 529 L 979 520 L 966 512 L 952 508 L 872 508 L 865 505 L 859 498 L 858 485 L 861 478 L 865 474 L 873 471 L 979 471 L 979 439 L 873 439 L 855 443 Z ' +
  'M 280 439 L 279 471 L 346 472 L 346 608 L 378 608 L 378 472 L 445 471 L 445 440 Z ' +
  'M 464 439 L 463 594 L 466 602 L 474 608 L 619 608 L 618 576 L 495 575 L 495 439 Z ' +
  'M 667 506 L 674 492 L 684 482 L 690 478 L 703 473 L 714 471 L 770 472 L 769 535 L 666 535 L 665 516 Z ' +
  'M 127 506 L 134 492 L 144 482 L 150 478 L 163 473 L 174 471 L 230 472 L 229 535 L 126 535 L 125 516 Z'

const diamondItems = [
  { delay: 0, node: <polygon points="43.571,18.182 33.702,18.182 38.636,23.117" /> },
  { delay: 1, node: <rect x="20.846" y="20.844" transform="matrix(0.7071 -0.7071 0.7071 0.7071 -11.2967 27.2733)" width="12.856" height="12.857" /> },
  { delay: 2, node: <polygon points="66.299,18.182 56.428,18.182 61.363,23.117" /> },
  { delay: 3, node: <rect x="43.57" y="20.84" transform="matrix(0.7072 -0.707 0.707 0.7072 -4.6396 43.3354)" width="12.856" height="12.858" /> },
  { delay: 4, node: <rect x="66.3" y="20.848" transform="matrix(0.7071 -0.7071 0.7071 0.7071 2.0128 59.4124)" width="12.857" height="12.856" /> },
  { delay: 5, node: <rect x="33.539" y="33.539" transform="matrix(-0.7071 0.7071 -0.7071 -0.7071 93.2749 38.6367)" width="10.194" height="10.194" /> },
  { delay: 6, node: <rect x="56.272" y="33.538" transform="matrix(-0.707 0.7072 -0.7072 -0.707 132.0796 22.5535)" width="10.193" height="10.194" /> },
  { delay: 7, node: <rect x="20.845" y="43.572" transform="matrix(-0.7071 -0.7071 0.7071 -0.7071 11.2043 104.6398)" width="12.856" height="12.856" /> },
  { delay: 8, node: <rect x="43.576" y="43.571" transform="matrix(-0.7072 -0.707 0.707 -0.7072 50.0198 120.7127)" width="12.857" height="12.856" /> },
  { delay: 9, node: <rect x="66.294" y="43.572" transform="matrix(-0.7071 -0.7071 0.7071 -0.7071 88.7877 136.7785)" width="12.857" height="12.856" /> },
  { delay: 10, node: <rect x="33.538" y="56.266" transform="matrix(-0.7071 0.7071 -0.7071 -0.7071 109.345 77.4322)" width="10.195" height="10.194" /> },
  { delay: 11, node: <rect x="56.273" y="56.266" transform="matrix(-0.7071 0.7072 -0.7072 -0.7071 148.1537 61.3524)" width="10.193" height="10.194" /> },
  { delay: 12, node: <rect x="20.846" y="66.295" transform="matrix(-0.7071 0.7071 -0.7071 -0.7071 97.9808 104.8644)" width="12.856" height="12.856" /> },
  { delay: 13, node: <rect x="43.572" y="66.293" transform="matrix(-0.7071 0.7071 -0.7071 -0.7071 136.7781 88.7868)" width="12.856" height="12.857" /> },
  { delay: 14, node: <rect x="66.298" y="66.299" transform="matrix(-0.7071 0.7071 -0.7071 -0.7071 175.5753 72.7284)" width="12.855" height="12.856" /> },
  { delay: 15, node: <polygon points="38.636,76.883 33.702,81.818 43.571,81.818" /> },
  { delay: 16, node: <polygon points="61.363,76.883 56.428,81.818 66.299,81.818" /> },
]

interface AtlasSplashScreenProps {
  onFinish?: () => void
}

export const AtlasSplashScreen = ({ onFinish }: AtlasSplashScreenProps) => {
  const [progress, setProgress] = useState(0)
  const finishCalled = useRef(false)

  useEffect(() => {
    finishCalled.current = false
    const startTime = performance.now()
    let rafId: number

    const tick = (now: number) => {
      const elapsed = now - startTime
      const p = Math.min(elapsed / DURATION, 1)
      setProgress(p)

      if (p < 1) {
        rafId = requestAnimationFrame(tick)
      } else if (!finishCalled.current) {
        finishCalled.current = true
        setTimeout(() => onFinish?.(), 400)
      }
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [onFinish])

  const frame = progress * TOTAL_FRAMES

  const closeLocalFrame = Math.max(0, frame - 3)
  const closeEased = easeOutQuad(Math.min(closeLocalFrame / 15, 1))
  const topTranslateY = (1 - closeEased) * CLOSE_OFFSET
  const bottomTranslateY = -(1 - closeEased) * CLOSE_OFFSET

  const polyFade = (delay: number) => {
    const start = 14 + delay * 3
    const end = start + 12
    return easeOutQuad(Math.max(0, Math.min(1, (frame - start) / (end - start))))
  }

  const diamondAnim = (delay: number) => {
    const start = 22 + delay
    const p = Math.max(0, Math.min(1, (frame - start) / 9))
    const eased = easeOut(p)
    return {
      opacity: eased,
      transform: `scale(${0.88 + 0.12 * eased}) rotate(${(1 - eased) * 8}deg)`,
      transformOrigin: 'center center',
      transformBox: 'fill-box' as const,
    }
  }

  const revealProgress = Math.max(0, Math.min(1, (frame - 40) / 15))
  const easedReveal = easeOutQuad(revealProgress)
  const logoSvgWidth = LOGO_INITIAL_SIZE - easedReveal * (LOGO_INITIAL_SIZE - LOGO_FINAL_SIZE)

  const wordmarkReveal = Math.max(0, Math.min(1, (frame - 48) / 14))
  const easedWordmark = easeOut(wordmarkReveal)
  const wordmarkDisplayWidth = 50 * easedWordmark

  const leftTopOpacity = polyFade(0)
  const leftMidOpacity = polyFade(1)
  const leftBotOpacity = polyFade(2)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          maxWidth: 900,
          padding: '0 24px',
        }}
      >
        <svg
          viewBox="-8 -8 120 135"
          preserveAspectRatio="xMidYMid meet"
          style={{ width: `${logoSvgWidth}%`, height: 'auto', display: 'block', flexShrink: 0 }}
        >
          <g transform="translate(-4.999449888030604, 0) scale(1.0999889557993634)" fill={TURQUOISE}>
            <g transform={`translate(0, ${topTranslateY})`}>
              <path d="M86.363,0H13.636c-5.02,0-9.091,6.105-9.091,13.636h90.91C95.455,6.105,91.385,0,86.363,0z" />
            </g>
            <g transform={`translate(0, ${bottomTranslateY})`}>
              <path d="M86.363,100H13.636c-5.021,0-9.091-6.105-9.091-13.637h90.91C95.455,93.895,91.385,100,86.363,100z" />
            </g>
            <g style={{ opacity: leftTopOpacity }}>
              <polygon points="20.844,18.182 4.545,18.182 4.545,36.364 20.844,36.364 11.852,27.174" />
            </g>
            <g style={{ opacity: leftMidOpacity }}>
              <polygon points="20.844,59.091 4.545,59.091 4.545,40.909 20.844,40.909 11.852,50.098" />
            </g>
            <g style={{ opacity: leftBotOpacity }}>
              <polygon points="20.844,63.637 4.545,63.637 4.545,81.818 20.844,81.818 11.852,72.629" />
            </g>
            <g style={{ opacity: leftTopOpacity }}>
              <polygon points="79.156,18.182 95.455,18.182 95.455,36.364 79.156,36.364 88.148,27.174" />
            </g>
            <g style={{ opacity: leftMidOpacity }}>
              <polygon points="79.156,59.091 95.455,59.091 95.455,40.909 79.156,40.909 88.148,50.098" />
            </g>
            <g style={{ opacity: leftBotOpacity }}>
              <polygon points="79.156,63.637 95.455,63.637 95.455,81.818 79.156,81.818 88.148,72.629" />
            </g>
            {diamondItems.map((item) => (
              <g key={item.delay} style={diamondAnim(item.delay)}>
                {item.node}
              </g>
            ))}
          </g>
        </svg>

        <div
          style={{
            opacity: easedWordmark,
            width: `${wordmarkDisplayWidth}%`,
            marginLeft: `${WORDMARK_GAP * easedWordmark}%`,
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <svg viewBox="93 439 902 169" style={{ width: '100%', height: 'auto', display: 'block' }}>
            <path d={WORDMARK_PATH} fill={TURQUOISE} fillRule="evenodd" clipRule="evenodd" />
          </svg>
        </div>
      </div>
    </div>
  )
}
