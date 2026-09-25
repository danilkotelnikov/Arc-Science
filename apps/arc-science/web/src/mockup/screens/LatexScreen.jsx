import React, {useRef, useState} from 'react';
import {Label} from '@heroui/react/label';
import {ListBox} from '@heroui/react/list-box';
import {NumberField} from '@heroui/react/number-field';
import {Select} from '@heroui/react/select';
import {Slider} from '@heroui/react/slider';
import {Switch} from '@heroui/react/switch';
import {useI18n} from '../../i18n/index.jsx';
import {Block, Kicker, Meta, Status} from '../ui.jsx';
import {LATEX_FILES, LATEX_SOURCE, LAYOUT_FONTS} from '../fixtures.js';

export default function LatexScreen() {
  const {t, locale} = useI18n();
  const gutter = useRef(null);
  const [file, setFile] = useState(LATEX_FILES[0].id);
  const [source, setSource] = useState(LATEX_SOURCE);
  const [font, setFont] = useState(LAYOUT_FONTS[0].id);
  const [size, setSize] = useState(11);
  const [leading, setLeading] = useState(15);
  const [para, setPara] = useState(6);
  const [margin, setMargin] = useState(18);
  const [columns, setColumns] = useState('1');
  const [hyphenEn, setHyphenEn] = useState(true);
  const [hyphenRu, setHyphenRu] = useState(false);

  const lines = source.split('\n');
  const stack = LAYOUT_FONTS.find(item => item.id === font)?.stack;

  return (
    <div className="mk-stack">
      <h1>{t('mk.screen.latex')}</h1>
      <div className="mk-latex">
        <section className="mk-stack">
          <h2>{t('mk.latex.files')}</h2>
          <ListBox
            aria-label={t('mk.latex.files')}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[file]}
            onSelectionChange={keys => { const next = [...keys][0]; if (next) setFile(String(next)); }}
          >
            {LATEX_FILES.map(item => (
              <ListBox.Item key={item.id} id={item.id} textValue={item.name}>
                <Label>{item.name}</Label>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
          <Meta>{t(LATEX_FILES.find(item => item.id === file).key)}</Meta>
        </section>

        <section className="mk-stack">
          <h2>{t('mk.latex.editor')}</h2>
          <div className="mk-editor">
            <div className="mk-gutter" aria-hidden="true" ref={gutter}>
              {lines.map((line, index) => <div key={`${index}-${line}`}>{index + 1}</div>)}
            </div>
            {/* No soft wrap: one source line stays on the gutter number that labels it. */}
            <textarea
              aria-label={t('mk.latex.editor')}
              value={source}
              onChange={event => setSource(event.target.value)}
              onScroll={event => { if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop; }}
              wrap="off"
              spellCheck="false"
            />
          </div>
          <div className="mk-row">
            <Kicker>{t('mk.latex.tokens')}</Kicker>
            <span className="mk-token" style={{color: 'var(--bp-accent-text)'}}>{t('mk.latex.token.macro')}</span>
            <span className="mk-token" style={{color: 'var(--bp-accent2-text)'}}>{t('mk.latex.token.math')}</span>
            <span className="mk-token" style={{color: 'var(--muted)'}}>{t('mk.latex.token.comment')}</span>
          </div>
        </section>

        <section className="mk-stack">
          <h2>{t('mk.latex.preview')}</h2>
          {[1, 2].map(page => (
            <figure key={page} style={{margin: 0}}>
              <div className="mk-page" />
              <figcaption className="bp-meta">{t('mk.latex.page', {n: page})}</figcaption>
            </figure>
          ))}
          <div className="mk-row">
            <Status state="failed">{t('mk.latex.qa')}</Status>
            <Meta>{t('mk.latex.qa.note')}</Meta>
          </div>
        </section>

        <section className="mk-stack">
          <h2>{t('mk.latex.layout')}</h2>
          <Select value={font} onChange={value => value && setFont(String(value))} fullWidth>
            <Label>{t('mk.latex.font')}</Label>
            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox>
                {LAYOUT_FONTS.map(item => (
                  <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
                    <Label>{item.label}</Label>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

          <NumberField value={size} onChange={value => setSize(value ?? 11)} minValue={8} maxValue={18} step={0.5}>
            <Label>{t('mk.latex.size')}</Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>

          <Slider value={leading} onChange={value => setLeading(Number(value))} minValue={10} maxValue={26} step={0.5}>
            <Label>{t('mk.latex.leading')}</Label>
            <Slider.Output />
            <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
          </Slider>

          <NumberField value={para} onChange={value => setPara(value ?? 6)} minValue={0} maxValue={18} step={1}>
            <Label>{t('mk.latex.paragraph')}</Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>

          <Slider value={margin} onChange={value => setMargin(Number(value))} minValue={10} maxValue={40} step={1}>
            <Label>{t('mk.latex.margins')}</Label>
            <Slider.Output />
            <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
          </Slider>

          <Select value={columns} onChange={value => value && setColumns(String(value))} fullWidth>
            <Label>{t('mk.latex.columns')}</Label>
            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox>
                {['1', '2'].map(value => (
                  <ListBox.Item key={value} id={value} textValue={value}>
                    <Label>{value}</Label>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

          <Switch isSelected={hyphenEn} onChange={setHyphenEn}>
            <Switch.Control><Switch.Thumb /></Switch.Control>
            <Switch.Content><Label>{t('mk.latex.hyphen.en')}</Label></Switch.Content>
          </Switch>
          <Switch isSelected={hyphenRu} onChange={setHyphenRu}>
            <Switch.Control><Switch.Thumb /></Switch.Control>
            <Switch.Content><Label>{t('mk.latex.hyphen.ru')}</Label></Switch.Content>
          </Switch>
        </section>
      </div>

      <Block className="mk-stack">
        <Kicker>{t('mk.latex.sample')}</Kicker>
        <p
          className="mk-sample"
          lang={locale}
          style={{
            '--mk-font': stack,
            '--mk-size': `${size}pt`,
            '--mk-leading': `${leading}pt`,
            '--mk-para': `${para}pt`,
            '--mk-margin': `${margin}mm`,
            '--mk-columns': columns,
            '--mk-hyphens': (locale === 'ru' ? hyphenRu : hyphenEn) ? 'auto' : 'manual',
          }}
        >
          {t('mk.latex.sample.text')}
        </p>
      </Block>
    </div>
  );
}
