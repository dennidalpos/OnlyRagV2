import { useEffect, useRef, useState } from 'react'
import { AgentActionLog } from '../types'

/**
 * Owns every ref/effect behind the action-log timeline's autoscroll behavior: tracking
 * explicit user scroll gestures (so autoscroll doesn't fight a user reading scrollback),
 * scrolling to bottom on new logs/streaming/execution-start, and the floating
 * "scroll to bottom" button's visibility.
 */
export function useAgentTimelineScroll(
  actionLogs: AgentActionLog[],
  streamingText: string,
  isExecuting: boolean,
  autoScroll: boolean,
  onToggleAutoScroll: () => void
) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isProgrammaticScrollRef = useRef<boolean>(false)
  const isUserScrolledUpRef = useRef<boolean>(false)
  const isUserInteractingRef = useRef<boolean>(false)
  const userInteractionTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [isScrolledUp, setIsScrolledUp] = useState<boolean>(false)

  // Track explicit user scroll gestures (mouse wheel or touch)
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    const handleUserInteraction = () => {
      isUserInteractingRef.current = true
      if (userInteractionTimeoutRef.current) clearTimeout(userInteractionTimeoutRef.current)
      userInteractionTimeoutRef.current = setTimeout(() => {
        isUserInteractingRef.current = false
      }, 600)
    }

    el.addEventListener('wheel', handleUserInteraction, { passive: true })
    el.addEventListener('touchmove', handleUserInteraction, { passive: true })

    return () => {
      el.removeEventListener('wheel', handleUserInteraction)
      el.removeEventListener('touchmove', handleUserInteraction)
      if (userInteractionTimeoutRef.current) clearTimeout(userInteractionTimeoutRef.current)
    }
  }, [])

  const handleScroll = () => {
    if (!scrollContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current
    const distanceToBottom = scrollHeight - scrollTop - clientHeight

    // Automatically re-attach autoscroll whenever container reaches near-bottom (<= 25px)
    if (distanceToBottom <= 25) {
      isUserScrolledUpRef.current = false
      setIsScrolledUp(false)
    } else if (distanceToBottom > 80 && isUserInteractingRef.current) {
      // Mark as scrolled up ONLY if the user performed an explicit wheel/touch gesture
      setIsScrolledUp(true)
      isUserScrolledUpRef.current = true
    }
  }

  const scrollToBottom = (smooth = true) => {
    if (!scrollContainerRef.current) return
    isProgrammaticScrollRef.current = true
    setIsScrolledUp(false)
    isUserScrolledUpRef.current = false

    if (smooth && !isExecuting && !streamingText) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth',
      })
    } else {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
      bottomRef.current?.scrollIntoView({ behavior: 'auto' })
    }

    requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
      }
      isProgrammaticScrollRef.current = false
    })
  }

  const handleToggleAutoScroll = () => {
    const next = !autoScroll
    onToggleAutoScroll()
    if (next) {
      setIsScrolledUp(false)
      isUserScrolledUpRef.current = false
      scrollToBottom(false)
    }
  }

  // When execution starts, automatically reset user scroll state and scroll to bottom
  const prevExecutingRef = useRef(isExecuting)
  useEffect(() => {
    if (isExecuting && !prevExecutingRef.current) {
      setIsScrolledUp(false)
      isUserScrolledUpRef.current = false
      scrollToBottom(false)
    }
    prevExecutingRef.current = isExecuting
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExecuting])

  // Continuous Autoscroll during action logs arrival and text streaming
  useEffect(() => {
    if (!autoScroll) return
    if (isUserScrolledUpRef.current) return

    const el = scrollContainerRef.current
    if (!el) return

    isProgrammaticScrollRef.current = true
    el.scrollTop = el.scrollHeight

    const rafId = requestAnimationFrame(() => {
      if (scrollContainerRef.current && !isUserScrolledUpRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
      }
      isProgrammaticScrollRef.current = false
    })

    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [actionLogs, streamingText, isExecuting, autoScroll])

  // ResizeObserver on message list to scroll to bottom as height increases during streaming
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    const observer = new ResizeObserver(() => {
      if (autoScroll && !isUserScrolledUpRef.current) {
        isProgrammaticScrollRef.current = true
        el.scrollTop = el.scrollHeight
        requestAnimationFrame(() => {
          isProgrammaticScrollRef.current = false
        })
      }
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [autoScroll])

  return {
    bottomRef,
    scrollContainerRef,
    isScrolledUp,
    handleScroll,
    scrollToBottom,
    handleToggleAutoScroll,
  }
}
