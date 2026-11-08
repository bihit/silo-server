package playback

import (
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
)

// streamCopyOnly holds the inverse of the playback.transcode_enabled server
// setting. While it is set, playback FFmpeg processes may only copy audio and
// video: a remux changes the container, never the streams.
var streamCopyOnly atomic.Bool

// SetStreamCopyOnly records whether the server has transcoding disabled. The
// server calls it at startup and whenever the playback config reloads.
func SetStreamCopyOnly(enabled bool) { streamCopyOnly.Store(enabled) }

// StreamCopyOnly reports whether playback may only stream-copy audio and video.
func StreamCopyOnly() bool { return streamCopyOnly.Load() }

// ErrStreamCopyOnly is returned instead of starting an FFmpeg process that
// would encode audio or video while transcoding is disabled.
var ErrStreamCopyOnly = errors.New("transcoding is disabled on this server: this client cannot play the source's audio or video codec unchanged, and the server does not convert it")

// TerminalMessageStreamCopyOnlyV3 answers a client whose codecs the source
// does not match while the server serves only unchanged streams.
const TerminalMessageStreamCopyOnlyV3 = "This device cannot play the file's audio or video format unchanged, and transcoding is disabled on this server. Choose another audio track or version, or use a player that supports these formats."

// refuseEncodingRouteV3 replaces a planned route that would encode audio or
// video, or burn in a subtitle, with the transcoding_disabled terminal.
// Direct play and pure stream-copy remuxes pass unchanged.
func refuseEncodingRouteV3(result PlannerResultV3) PlannerResultV3 {
	if result.Plan == nil {
		return result
	}
	encodesVideo := result.PlayMethod == PlayTranscode ||
		(result.TargetVideoCodec != "" && !strings.EqualFold(result.TargetVideoCodec, "copy"))
	if !encodesVideo && !result.TranscodeAudio && !result.SubtitleBurnIn {
		return result
	}
	return terminalPlannerResultV3("transcoding_disabled", TerminalMessageStreamCopyOnlyV3, false)
}

// guardStreamCopyArgs refuses FFmpeg arguments that would encode or filter
// audio or video while StreamCopyOnly is set. Bitstream filters and subtitle
// conversion stay allowed: neither re-encodes audio or video.
func guardStreamCopyArgs(args []string) error {
	if !StreamCopyOnly() {
		return nil
	}
	return checkStreamCopyArgs(args)
}

// checkStreamCopyArgs requires every audio and video output stream to be
// copied: codec options after the last input must be "copy", no filter graph
// may run, and each of video and audio is either copied or disabled.
func checkStreamCopyArgs(args []string) error {
	lastInput := -1
	for i, arg := range args {
		if arg == "-i" {
			lastInput = i
		}
	}
	videoCovered, audioCovered := false, false
	for i := 0; i < len(args); i++ {
		opt := args[i]
		switch {
		case opt == "-vn":
			videoCovered = true
			continue
		case opt == "-an":
			audioCovered = true
			continue
		case isFilterOption(opt):
			return fmt.Errorf("%w (refused FFmpeg filter %s)", ErrStreamCopyOnly, opt)
		}
		kind, ok := codecOptionStreamKind(opt)
		if !ok || i+1 >= len(args) {
			continue
		}
		value := args[i+1]
		i++
		// Codec options before the last -i choose decoders for an input.
		if i-1 < lastInput {
			continue
		}
		switch kind {
		case 's', 'd', 't':
			continue
		}
		if !strings.EqualFold(value, "copy") {
			return fmt.Errorf("%w (refused encoder %s %s)", ErrStreamCopyOnly, opt, value)
		}
		switch kind {
		case 'v':
			videoCovered = true
		case 'a':
			audioCovered = true
		case 0:
			videoCovered, audioCovered = true, true
		}
	}
	// FFmpeg encodes a mapped stream that has no codec option with its
	// default encoder, so a missing copy is an encode.
	mapsVideo, mapsAudio := mappedStreamKinds(args)
	if mapsVideo && !videoCovered {
		return fmt.Errorf("%w (video is not stream-copied)", ErrStreamCopyOnly)
	}
	if mapsAudio && !audioCovered {
		return fmt.Errorf("%w (audio is not stream-copied)", ErrStreamCopyOnly)
	}
	return nil
}

// mappedStreamKinds reports whether the output may carry video or audio.
// Without -map, FFmpeg selects both automatically; a map naming a whole input
// or a bare stream index may carry either.
func mappedStreamKinds(args []string) (video, audio bool) {
	mapped := false
	for i := 0; i+1 < len(args); i++ {
		if args[i] != "-map" {
			continue
		}
		mapped = true
		value := args[i+1]
		i++
		if strings.HasPrefix(value, "-") {
			continue
		}
		parts := strings.Split(value, ":")
		if len(parts) < 2 || parts[1] == "" {
			video, audio = true, true
			continue
		}
		switch parts[1][0] {
		case 'v', 'V':
			video = true
		case 'a':
			audio = true
		case 's', 'd', 't':
		default:
			video, audio = true, true
		}
	}
	if !mapped {
		return true, true
	}
	return video, audio
}

// codecOptionStreamKind reports whether opt selects a codec and for which
// stream kind: 'v', 'a', 's', 'd' or 't', 0 for every stream, and 'x' for a
// stream index or other specifier that may name audio or video.
func codecOptionStreamKind(opt string) (byte, bool) {
	switch opt {
	case "-vcodec":
		return 'v', true
	case "-acodec":
		return 'a', true
	case "-scodec":
		return 's', true
	case "-dcodec":
		return 'd', true
	case "-c", "-codec":
		return 0, true
	}
	var spec string
	switch {
	case strings.HasPrefix(opt, "-c:"):
		spec = opt[len("-c:"):]
	case strings.HasPrefix(opt, "-codec:"):
		spec = opt[len("-codec:"):]
	default:
		return 0, false
	}
	if spec == "" {
		return 0, true
	}
	switch spec[0] {
	case 'v', 'V':
		return 'v', true
	case 'a', 's', 'd', 't':
		return spec[0], true
	}
	return 'x', true
}

func isFilterOption(opt string) bool {
	switch opt {
	case "-vf", "-af", "-filter_complex", "-lavfi", "-filter_complex_script", "-filter":
		return true
	}
	return strings.HasPrefix(opt, "-filter:") || strings.HasPrefix(opt, "-filter_script")
}
