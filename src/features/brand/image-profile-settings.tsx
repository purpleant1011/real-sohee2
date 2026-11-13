'use client'

import React, { useState } from 'react'
import styles from './image-profile-settings.module.css'

export function ImageProfileSettings() {
  const [photoStyle, setPhotoStyle] = useState('실제 매장 촬영 느낌')
  const [personExposure, setPersonExposure] = useState('no_face')
  const [textInclusion, setTextInclusion] = useState('no_text')
  const [colorTone, setColorTone] = useState('따뜻한')
  const [savedSuccess, setSavedSuccess] = useState(false)

  const [keepElements, setKeepElements] = useState<string[]>([
    '매장 인테리어 분위기',
    '실제 서비스 스타일',
  ])
  const [avoidElements, setAvoidElements] = useState<string[]>([
    '지나치게 과장된 Before/After',
    '인위적인 피부/머리 표현',
  ])

  const toggleKeep = (item: string) => {
    setKeepElements((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    )
  }

  const toggleAvoid = (item: string) => {
    setAvoidElements((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    )
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    setSavedSuccess(true)
    setTimeout(() => setSavedSuccess(false), 2500)
  }

  return (
    <section className={styles.container} aria-labelledby="image-settings-heading">
      <div className={styles.header}>
        <div>
          <span className={styles.tag}>🎨 브랜드 비주얼 일관성</span>
          <h2 id="image-settings-heading" className={styles.title}>
            우리 매장 이미지 스타일 (Brand Image Profile)
          </h2>
          <p className={styles.subtitle}>
            소희가 인스타그램과 블로그용 이미지를 생성할 때 매장의 정체성과 서비스 퀄리티를 온전히 담아내도록 가이드해요.
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className={styles.form}>
        {/* 1. Photo Style */}
        <div className={styles.sectionBox}>
          <label className={styles.sectionTitle}>1. 어떤 사진 느낌을 선호하세요?</label>
          <div className={styles.chipGrid}>
            {[
              '실제 매장 촬영 느낌',
              '깨끗한 화보 느낌',
              '자연스러운 스마트폰 사진',
              '고급스러운 에디토리얼',
            ].map((style) => (
              <button
                type="button"
                key={style}
                className={`${styles.chipBtn} ${photoStyle === style ? styles.chipBtnActive : ''}`}
                onClick={() => setPhotoStyle(style)}
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        {/* 2. Person Exposure */}
        <div className={styles.sectionBox}>
          <label className={styles.sectionTitle}>2. 사람 및 얼굴 노출</label>
          <div className={styles.radioList}>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name="person"
                value="no_face"
                checked={personExposure === 'no_face'}
                onChange={() => setPersonExposure('no_face')}
              />
              <span>손님 얼굴은 가급적 노출하지 않기 (뒷모습, 옆모습, 손동작 위주)</span>
            </label>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name="person"
                value="natural"
                checked={personExposure === 'natural'}
                onChange={() => setPersonExposure('natural')}
              />
              <span>자연스럽게 매장 내 서비스 모습 포함</span>
            </label>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name="person"
                value="face_centric"
                checked={personExposure === 'face_centric'}
                onChange={() => setPersonExposure('face_centric')}
              />
              <span>인물 및 헤어 모델 중심 촬영</span>
            </label>
          </div>
        </div>

        {/* 3. Text Inclusion */}
        <div className={styles.sectionBox}>
          <label className={styles.sectionTitle}>3. 이미지 속 텍스트 삽입 여부</label>
          <div className={styles.radioList}>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name="textInclusion"
                value="no_text"
                checked={textInclusion === 'no_text'}
                onChange={() => setTextInclusion('no_text')}
              />
              <span>이미지 안에 글자 넣지 않기 (깔끔한 원본 사진 유지)</span>
            </label>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name="textInclusion"
                value="short_title"
                checked={textInclusion === 'short_title'}
                onChange={() => setTextInclusion('short_title')}
              />
              <span>감성적인 짧은 제목만 심플하게 허용</span>
            </label>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name="textInclusion"
                value="promo_text"
                checked={textInclusion === 'promo_text'}
                onChange={() => setTextInclusion('promo_text')}
              />
              <span>프로모션/이벤트 혜택 문구 포함</span>
            </label>
          </div>
        </div>

        {/* 4. Color Tone */}
        <div className={styles.sectionBox}>
          <label className={styles.sectionTitle}>4. 전체 색감 및 무드</label>
          <div className={styles.chipGrid}>
            {['따뜻한 (웜톤)', '자연스러운 (내추럴)', '선명하고 생생한', '차분하고 모던한'].map((tone) => (
              <button
                type="button"
                key={tone}
                className={`${styles.chipBtn} ${colorTone === tone ? styles.chipBtnActive : ''}`}
                onClick={() => setColorTone(tone)}
              >
                {tone}
              </button>
            ))}
          </div>
        </div>

        {/* 5. Keep and Avoid Rules */}
        <div className={styles.twoColumnGrid}>
          <div className={styles.rulesColumn}>
            <strong className={styles.keepHeading}>✓ 꼭 유지할 것 (브랜드 원칙)</strong>
            <div className={styles.tagsGroup}>
              {['매장 인테리어 분위기', '브랜드 로고', '실제 서비스 스타일', '사장님 시그니처 룩'].map((item) => (
                <button
                  type="button"
                  key={item}
                  className={`${styles.tagItem} ${keepElements.includes(item) ? styles.tagItemActive : ''}`}
                  onClick={() => toggleKeep(item)}
                >
                  {keepElements.includes(item) ? '✓ ' : '+ '} {item}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.rulesColumn}>
            <strong className={styles.avoidHeading}>✕ 절대 만들지 말 것 (안전 가드)</strong>
            <div className={styles.tagsGroup}>
              {[
                '지나치게 과장된 Before/After',
                '인위적인 피부/머리 표현',
                '어색한 손가락 AI 왜곡',
                '타사 로고나 워터마크',
              ].map((item) => (
                <button
                  type="button"
                  key={item}
                  className={`${styles.tagItem} ${avoidElements.includes(item) ? styles.tagAvoidActive : ''}`}
                  onClick={() => toggleAvoid(item)}
                >
                  {avoidElements.includes(item) ? '✕ ' : '- '} {item}
                </button>
              ))}
            </div>
          </div>
        </div>

        {savedSuccess && (
          <div className={styles.savedAlert}>
            ✓ 우리 매장 이미지 스타일 프로필이 저장되었습니다! 다음 이미지 생성 시 자동 반영됩니다.
          </div>
        )}

        <div className={styles.formFooter}>
          <button type="submit" className={styles.saveProfileBtn}>
            우리 매장 스타일 저장하기
          </button>
        </div>
      </form>
    </section>
  )
}
