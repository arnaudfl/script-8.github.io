import React, { Component } from 'react'
import { connect } from 'react-redux'
import _ from 'lodash'
import * as Tone from 'tone'
import classNames from 'classnames'
import {
  createSynth,
  tempoToPlaybackRate,
  triggerAttack,
  triggerRelease
} from '../iframe/src/soundAPI/index.js'
import actions from '../actions/actions.js'
import TextInput from '../components/TextInput.js'
import settings from '../iframe/src/settings.js'

const synths = _.range(settings.chainChannels).map(index =>
  createSynth({ index })
)
Tone.Transport.bpm.value = settings.bpm
Tone.Transport.start(settings.startOffset)

const mapStateToProps = ({ songs, chains, phrases, selectedUi }) => ({
  songs,
  chains,
  phrases,
  selectedUi
})

const getCurrentSong = ({ songs, selectedUi }) => ({
  tempo: 0,
  ..._.get(songs, [selectedUi.song], {})
})

const songIsEmpty = song =>
  !_.intersection(
    Object.keys(song),
    _.range(settings.matrixLength).map(i => i.toString())
  ).length

const mapDispatchToProps = dispatch => ({
  selectUi: payload => dispatch(actions.selectUi(payload)),
  updateSong: ({ song, index }) =>
    dispatch(
      actions.updateSong({
        song,
        index
      })
    )
})

class Song extends Component {
  constructor(props) {
    super(props)

    this.handleClear = this.handleClear.bind(this)
    this.keydown = this.keydown.bind(this)
    this.handleTempoChange = this.handleTempoChange.bind(this)
    this.handleSongIndexChange = this.handleSongIndexChange.bind(this)
    this.handleChainClick = this.handleChainClick.bind(this)
    this.handlePlay = this.handlePlay.bind(this)
    this.drawCallback = this.drawCallback.bind(this)

    this.state = {
      isPlaying: false,
      playingIndex: 0
    }
  }

  handleClear(e) {
    e.currentTarget.blur()
    const { updateSong, selectedUi } = this.props
    const songIndex = selectedUi.song

    if (window.confirm('Do you really want to clear this song?')) {
      updateSong({
        song: {
          tempo: 0
        },
        index: songIndex
      })
    }
  }

  drawCallback(playingIndex) {
    this.setState({
      playingIndex
    })
  }

  componentDidMount() {
    Tone.context.resume()

    const { chains, phrases } = this.props
    const song = getCurrentSong(this.props)

    this.sequence = new Tone.Sequence(
      (time, index) => {
        const song = getCurrentSong(this.props)

        // Get the chain, phrase and note positions by using base math.
        const [chainPosition, phrasePosition, notePosition] = _.padStart(
          index.toString(settings.matrixLength),
          3,
          0
        )
          .split('')
          .map(d => parseInt(d, settings.matrixLength))

        // Get the chain index for this position.
        const chainIndex = _.get(song, chainPosition)

        // Get the chain.
        const chain = _.get(chains, chainIndex)

        // Get the phrase indices for this position, e.g. { 0: 0, 1: 11, 2: 2 }
        const phrasesIndices = _.get(chain, phrasePosition)

        // For each channel,
        _.range(settings.chainChannels).forEach(channel => {
          // get the phrase index.
          const phraseIndex = _.get(phrasesIndices, channel)

          // If the phrase index exists,
          if (!_.isNil(phraseIndex)) {
            // get the phrase assigned to this channel.
            const phrase = _.get(phrases, phraseIndex, {})

            // Get the note element for this position.
            const noteElement = _.get(phrase.notes, notePosition)

            // If we have a note:
            if (!_.isNil(noteElement)) {
              // if we have a non-sustain note, triggerAttack.
              if (noteElement.octave > -1) {
                triggerAttack({
                  ...noteElement,
                  time,
                  synth: synths[channel]
                })
              }
              // If we have a sustain, do nothing.
              if (noteElement.octave === -1) {
              }
            } else {
              // If we don't have a note, triggerRelease.
              triggerRelease({ time, synth: synths[channel] })
            }
          } else {
            // If the phrase doesn't exist, stop the synth.
            triggerRelease({ time, synth: synths[channel] })
          }
        })

        Tone.Draw.schedule(() => {
          this.drawCallback(chainPosition)
        }, time)
      },
      _.range(Math.pow(settings.matrixLength, 3)),
      settings.subdivision
    )

    this.sequence.playbackRate = tempoToPlaybackRate(song.tempo)
    window.addEventListener('keydown', this.keydown)
  }

  handleTempoChange(e) {
    const { validity, value } = e.target
    if (validity.valid) {
      // Update the sequence.
      this.sequence.playbackRate = tempoToPlaybackRate(value)

      // Update the store.
      const { updateSong, selectedUi } = this.props
      const song = getCurrentSong(this.props)
      const newSong = { ...song, tempo: value }
      const songIndex = selectedUi.song
      updateSong({ song: newSong, index: songIndex })
    }
  }

  handlePlay() {
    const { isPlaying } = this.state
    if (isPlaying) {
      this.sequence.stop()
      synths.forEach(synth => triggerRelease({ synth }))
    } else {
      this.sequence.start(settings.startOffset)
    }
    this.setState({
      isPlaying: !isPlaying,
      playingIndex: 0
    })
  }

  handleSongIndexChange(e) {
    const { validity, value } = e.target
    if (validity.valid) {
      const { selectUi, selectedUi } = this.props
      selectUi({
        ...selectedUi,
        song: value
      })
    }
  }

  handleChainClick({ col }) {
    const { chains, updateSong, selectedUi } = this.props
    const songIndex = selectedUi.song
    const song = getCurrentSong(this.props)
    let newChain = _.get(song, col)

    // Get chains, in order.
    const sortedChains = _(Object.keys(chains))
      .sortBy(d => +d)
      .uniq()
      .map(d => +d)
      .value()

    // If the cell is empty,
    if (_.isNil(newChain)) {
      // set the last chain.
      newChain = _.last(sortedChains)
    } else {
      // If the cell is not empty,
      // and if it shows the first chain,
      const newChainIndex = _.indexOf(sortedChains, newChain)

      if (newChainIndex === 0) {
        // clear.
        newChain = null
      } else {
        // Otherwise decrease chain.
        newChain = sortedChains[newChainIndex - 1]
      }
    }

    const newSong = {
      ...song,
      [col]: newChain
    }

    updateSong({ song: newSong, index: songIndex })
  }

  keydown(event) {
    // If we pressed space,
    if (event.code === 'Space') {
      // toggle the playbar.
      this.handlePlay()
    }
  }

  componentWillUnmount() {
    this.drawCallback = () => {}
    this.sequence.stop()
    synths.forEach(synth => triggerRelease({ synth }))
    window.removeEventListener('keydown', this.keydown)
  }

  componentDidUpdate(prevProps) {
    const oldSong = getCurrentSong(prevProps)
    const newSong = getCurrentSong(this.props)
    if (
      prevProps.selectedUi.song !== this.props.selectedUi.song ||
      oldSong.tempo !== newSong.tempo
    ) {
      this.sequence.playbackRate = tempoToPlaybackRate(newSong.tempo)
    }
  }

  render() {
    const { selectedUi } = this.props
    const songIndex = selectedUi.song
    const { isPlaying, playingIndex } = this.state
    const song = getCurrentSong(this.props)
    const { chains } = this.props

    return (
      <div className="Song two-rows-and-grid">
        <div className="main">
          <div className={classNames('warning', { hide: !_.isEmpty(chains) })}>
            error: no chains found
          </div>
          <div className={classNames('settings', { hide: _.isEmpty(chains) })}>
            <div className="title">Song</div>
            <TextInput
              label="#"
              value={songIndex.toString()}
              handleChange={this.handleSongIndexChange}
              type="number"
              options={{ min: 0, max: settings.songs - 1 }}
            />
            <div className="title">Tempo</div>
            <TextInput
              label="#"
              value={song.tempo.toString()}
              handleChange={this.handleTempoChange}
              type="number"
              options={{ min: 0, max: 7 }}
            />
          </div>
          <div className={classNames('matrix', { hide: _.isEmpty(chains) })}>
            <button
              className={classNames('play button', { active: isPlaying })}
              onClick={this.handlePlay}
            >
              {isPlaying ? 'stop' : 'play'}
            </button>
            <table className="songs">
              <tbody>
                <tr>
                  <td>c</td>
                  {_.range(settings.matrixLength).map(col => {
                    const chain = _.get(song, col)
                    const highlighter =
                      col === playingIndex && isPlaying ? (
                        <span className="highlight" />
                      ) : null
                    return (
                      <td
                        key={col}
                        className={classNames({
                          highlight:
                            col === playingIndex && isPlaying && !_.isNil(chain)
                        })}
                        onClick={() => this.handleChainClick({ col })}
                      >
                        {highlighter}
                        <button>
                          <span>
                            {_.isNil(chain) ? '' : _.padStart(chain, 2, 0)}
                          </span>
                        </button>
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="tools">
            <div>
              <button
                className="button"
                disabled={songIsEmpty(song)}
                onClick={this.handleClear}
              >
                clear
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }
}

export default connect(mapStateToProps, mapDispatchToProps)(Song)
