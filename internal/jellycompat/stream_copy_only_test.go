package jellycompat

import (
	"testing"

	"github.com/Silo-Server/silo-server/internal/catalog"
	"github.com/Silo-Server/silo-server/internal/models"
	"github.com/Silo-Server/silo-server/internal/playback"
)

// With transcoding disabled on the server, a media source offers only stream
// copies: no audio conversion, no video encode, no subtitle burn-in. The
// client's own EnableTranscoding flag cannot turn encoding back on.
func TestBuildPlaybackSourceStreamCopyOnly(t *testing.T) {
	version := catalog.FileVersion{
		FileID: 7, Container: "mkv", CodecVideo: "hevc", CodecAudio: "truehd", Resolution: "1080p",
		VideoTracks: []models.VideoTrack{{Codec: "hevc", Width: 1920, Height: 1080}},
		AudioTracks: []models.AudioTrack{{Codec: "truehd", Channels: 8, Default: true}},
	}
	h := &PlaybackHandler{codec: NewResourceIDCodec()}
	profile := DefaultDeviceProfile()
	enable := true
	req := playbackInfoRequest{EnableTranscoding: &enable}
	t.Cleanup(func() { playback.SetStreamCopyOnly(false) })

	playback.SetStreamCopyOnly(false)
	encoding := h.buildPlaybackSource("item", "play", version, profile, req, true)
	if !encoding.TranscodeAudio && !(encoding.SupportsTranscoding && !encoding.HLSRemux) {
		t.Fatalf("fixture needs an encode with transcoding enabled: %+v", encoding)
	}

	playback.SetStreamCopyOnly(true)
	source := h.buildPlaybackSource("item", "play", version, profile, req, true)
	if source.TranscodeAudio || source.CanBurnSubtitle {
		t.Fatalf("stream-copy-only source converts audio or burns subtitles: %+v", source)
	}
	if source.SupportsTranscoding && !source.HLSRemux {
		t.Fatalf("stream-copy-only source offers a video encode: %+v", source)
	}
}
