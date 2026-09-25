import React, {useEffect, useState} from 'react';
import {Accordion} from '@heroui/react/accordion';
import {Button} from '@heroui/react/button';
import {Card} from '@heroui/react/card';
import {Checkbox} from '@heroui/react/checkbox';
import {Chip} from '@heroui/react/chip';
import {Drawer} from '@heroui/react/drawer';
import {Label} from '@heroui/react/label';
import {Link} from '@heroui/react/link';
import {ListBox} from '@heroui/react/list-box';
import {Modal} from '@heroui/react/modal';
import {Popover} from '@heroui/react/popover';
import {Select} from '@heroui/react/select';
import {useI18n} from '../../i18n/index.jsx';
import {PALETTES} from '../../theme/palettes.js';
import {GravityIcon} from '../../theme/gravity-icons.jsx';
import {Block, Field, Kicker, LabelledTextArea, LanguageToggle, Meta, Status} from '../ui.jsx';
import {CONNECTORS, EFFORTS, PROBE, PROPOSALS, PROVIDERS, SEATS} from '../fixtures.js';

/** Font check: the Font Loading API first, then a width comparison. Both can be absent. */
function hseInstalled() {
  try {
    if (typeof document.fonts?.check === 'function') return document.fonts.check('12px "HSE Sans"');
  } catch { /* blocked or unsupported: fall through to measurement */ }
  try {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:40px';
    probe.innerHTML = '<span style="font-family:\'HSE Sans\',monospace">Arc Science 2026</span>'
      + '<span style="font-family:monospace">Arc Science 2026</span>';
    document.body.append(probe);
    const [candidate, fallback] = probe.children;
    const differs = candidate.offsetWidth > 0 && candidate.offsetWidth !== fallback.offsetWidth;
    probe.remove();
    return differs;
  } catch { return false; }
}

function SeatDrawer({seat, onClose}) {
  const {t} = useI18n();
  const [provider, setProvider] = useState(seat?.provider ?? null);
  const [model, setModel] = useState(seat?.model ?? null);
  const [effort, setEffort] = useState(seat?.effort ?? null);
  useEffect(() => { setProvider(seat?.provider ?? null); setModel(seat?.model ?? null); setEffort(seat?.effort ?? null); }, [seat]);
  const models = PROVIDERS.find(item => item.id === provider)?.models || [];
  return (
    <Drawer.Backdrop isOpen={!!seat} onOpenChange={open => { if (!open) onClose(); }}>
      <Drawer.Content placement="right">
        <Drawer.Dialog>
          <Drawer.CloseTrigger />
          <Drawer.Header><Drawer.Heading>{t('mk.seat.edit')}</Drawer.Heading></Drawer.Header>
          <Drawer.Body className="mk-stack">
            {seat ? (
              <>
                <h3>{t(`${seat.key}.title`)}</h3>
                <Select value={provider} onChange={value => { setProvider(String(value)); setModel(null); }} fullWidth>
                  <Label>{t('mk.seat.provider')}</Label>
                  <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {PROVIDERS.map(item => (
                        <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
                          <Label>{item.label}</Label>
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                <Select value={model} onChange={value => setModel(String(value))} fullWidth>
                  <Label>{t('mk.seat.model')}</Label>
                  <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {models.map(name => (
                        <ListBox.Item key={name} id={name} textValue={name}>
                          <Label>{name}</Label>
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                <Select value={effort} onChange={value => setEffort(String(value))} fullWidth>
                  <Label>{t('mk.seat.effort')}</Label>
                  <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {EFFORTS.map(name => (
                        <ListBox.Item key={name} id={name} textValue={t(`mk.effort.${name}`)}>
                          <Label>{t(`mk.effort.${name}`)}</Label>
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                <Field label={t('mk.seat.credential')}>{t(`mk.seat.credential.${seat.credential}`)}</Field>
                <Meta>{t('mk.seat.no_secrets')}</Meta>
              </>
            ) : null}
          </Drawer.Body>
          <Drawer.Footer>
            <Button slot="close" variant="secondary">{t('common.cancel')}</Button>
            <Button slot="close">{t('common.save')}</Button>
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}

function AddMcpModal({isOpen, onOpenChange}) {
  const {t} = useI18n();
  const [source, setSource] = useState('');
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="md">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header><Modal.Heading>{t('mk.connector.add.heading')}</Modal.Heading></Modal.Header>
          <Modal.Body className="mk-stack">
            <LabelledTextArea
              id="mk-add-mcp-source"
              label={t('mk.connector.add.field')}
              className="h-28 w-full"
              value={source}
              onChange={event => setSource(event.target.value)}
            />
            <Meta>{t('mk.connector.add.hint')}</Meta>
            <Kicker>{t('mk.connector.probe')}</Kicker>
            <ul className="mk-stack">
              {PROBE.map(item => (
                <li key={item.id} className="mk-row">
                  <Status state={item.state}>{t(`state.${item.state}`)}</Status>
                  <span>{t(item.key)}</span>
                </li>
              ))}
            </ul>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="secondary">{t('common.cancel')}</Button>
            <Button slot="close">{t('common.apply')}</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

export default function SettingsScreen({palette, onPalette}) {
  const {t, locale, setLocale} = useI18n();
  const [seat, setSeat] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [ticked, setTicked] = useState(() => new Set(['g2']));
  const [font, setFont] = useState(false);
  useEffect(() => { setFont(hseInstalled()); }, []);

  const toggle = id => setTicked(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="mk-stack">
      <h1>{t('mk.screen.settings')}</h1>

      <section className="mk-stack">
        <h2>{t('mk.settings.seats')}</h2>
        <div className="mk-board">
          {SEATS.map(item => (
            <Card key={item.id}>
              <Card.Header>
                <Card.Title>{t(`${item.key}.title`)}</Card.Title>
                <Card.Description>{t(`${item.key}.role`)}</Card.Description>
              </Card.Header>
              <Card.Content className="mk-stack">
                <Meta>{PROVIDERS.find(provider => provider.id === item.provider)?.label} {item.model}</Meta>
                <div className="mk-row">
                  <Chip variant="tertiary">{t(`mk.effort.${item.effort}`)}</Chip>
                  <Status state={item.credential === 'ready' ? 'ready' : 'not_tested'}>
                    {t(`mk.seat.credential.${item.credential}`)}
                  </Status>
                </div>
              </Card.Content>
              <Card.Footer>
                <Button variant="secondary" onPress={() => setSeat(item)}>{t('common.edit')}</Button>
              </Card.Footer>
            </Card>
          ))}
        </div>
      </section>

      <Accordion allowsMultipleExpanded defaultExpandedKeys={['connectors']}>
        <Accordion.Item id="connectors">
          <Accordion.Heading>
            <Accordion.Trigger>{t('mk.settings.connectors')}<Accordion.Indicator /></Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className="mk-stack">
              <ul className="mk-stack">
                {CONNECTORS.map(item => (
                  <li key={item.id} className="mk-row">
                    <Status state={item.state}>{t(`state.${item.state}`)}</Status>
                    <strong>{t(`${item.key}.title`)}</strong>
                    <span>{t(`${item.key}.note`)}</span>
                    <span className="mk-row mk-row--tight">
                    <Chip size="sm" variant="tertiary">{t('mk.connector.licence')} {item.licence}</Chip>
                    <Popover>
                      <Popover.Trigger>
                        <Button variant="ghost" isIconOnly aria-label={t('mk.connector.hint')}>
                          <GravityIcon name="circle-info" />
                        </Button>
                      </Popover.Trigger>
                      <Popover.Content>
                        <Popover.Dialog>
                          <Popover.Heading>{t('mk.connector.hint')}</Popover.Heading>
                          <p>{t(`${item.key}.note`)}</p>
                        </Popover.Dialog>
                      </Popover.Content>
                    </Popover>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mk-row">
                <Button variant="secondary" onPress={() => setAddOpen(true)}>
                  <GravityIcon name="plug" />
                  {t('mk.connector.add')}
                </Button>
              </div>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item id="configure">
          <Accordion.Heading>
            <Accordion.Trigger>{t('mk.settings.configure')}<Accordion.Indicator /></Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className="mk-stack">
              {PROPOSALS.map(item => (
                <div key={item.id} className="mk-stack">
                  <Checkbox isSelected={ticked.has(item.id)} onChange={() => toggle(item.id)}>
                    <Checkbox.Content>
                      <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                      {t(`${item.key}.title`)}
                    </Checkbox.Content>
                  </Checkbox>
                  <Meta>{t('mk.configure.reason')}: {t(`${item.key}.reason`)}</Meta>
                  <Meta>{t('mk.configure.risk')}: {t(`${item.key}.risk`)}</Meta>
                </div>
              ))}
              <div className="mk-row">
                <Button isDisabled={ticked.size === 0}>{t('mk.configure.apply')}</Button>
              </div>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item id="appearance">
          <Accordion.Heading>
            <Accordion.Trigger>{t('mk.settings.appearance')}<Accordion.Indicator /></Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className="mk-stack">
              <Kicker>{t('mk.appearance.palette')}</Kicker>
              <div className="mk-board">
                {PALETTES.map(item => (
                  <Block key={item.id} className="mk-stack">
                    <strong>{t(item.labelKey)}</strong>
                    <div className="mk-row">
                      {[item.colors.background, item.colors.foreground, item.colors.accent, item.colors.accent2].map((hex, index) => (
                        <span key={`${index}-${hex}`} style={{width: 24, height: 24, background: hex, border: '2px solid currentColor'}} />
                      ))}
                    </div>
                    <Button
                      variant={palette === item.id ? 'primary' : 'secondary'}
                      onPress={() => onPalette(item.id)}
                    >
                      {palette === item.id ? t('mk.logos.in_use') : t('common.apply')}
                    </Button>
                  </Block>
                ))}
              </div>

              <Kicker>{t('mk.appearance.language')}</Kicker>
              <LanguageToggle locale={locale} setLocale={setLocale} label={t('mk.appearance.language')} />

              <p className="mk-row">
                <Status state={font ? 'ready' : 'not_tested'}>
                  {t(font ? 'mk.appearance.font.installed' : 'mk.appearance.font.missing')}
                </Status>
                <Link href="https://www.hse.ru/info/brandbook/" target="_blank" rel="noreferrer">
                  {t('mk.appearance.font.link')}
                  <Link.Icon />
                </Link>
              </p>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      <SeatDrawer seat={seat} onClose={() => setSeat(null)} />
      <AddMcpModal isOpen={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
