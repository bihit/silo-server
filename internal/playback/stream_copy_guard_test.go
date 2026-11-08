package playback

import (
	"errors"
	"testing"
)

func TestCheckStreamCopyArgs(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name string
		args []string
		ok   bool
	}{
		{"remux copy", []string{"-i", "in.mkv", "-map", "0:V:0", "-map", "0:a:0?", "-sn", "-dn", "-c", "copy", "-f", "mp4", "pipe:1"}, true},
		{"hls copy", []string{"-ss", "10", "-i", "in.mkv", "-map", "0:v:0", "-map", "0:a:1", "-c:v", "copy", "-bsf:v", "hevc_mp4toannexb", "-c:a", "copy", "-f", "hls", "out.m3u8"}, true},
		{"audio-only copy", []string{"-i", "book.m4b", "-map", "0:a:0", "-c:a", "copy", "-f", "hls", "out.m3u8"}, true},
		{"text subtitle conversion", []string{"-i", "in.mkv", "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy", "-c:a", "copy", "-c:s", "webvtt", "-f", "hls", "out.m3u8"}, true},
		{"input decoder before -i", []string{"-c:v", "h264_cuvid", "-i", "in.mkv", "-c", "copy", "-f", "mp4", "pipe:1"}, true},
		{"filter thread counts", []string{"-i", "in.mkv", "-filter_threads", "1", "-filter_complex_threads", "1", "-c", "copy", "-f", "mp4", "pipe:1"}, true},
		{"audio transcode remux", []string{"-i", "in.mkv", "-map", "0:V:0", "-map", "0:a:0?", "-c:v", "copy", "-c:a", "aac", "-ac", "2", "-f", "mp4", "pipe:1"}, false},
		{"video encode", []string{"-i", "in.mkv", "-c:v", "libx264", "-c:a", "copy", "-f", "hls", "out.m3u8"}, false},
		{"hardware encode", []string{"-i", "in.mkv", "-c:v", "h264_nvenc", "-c:a", "copy", "-f", "hls", "out.m3u8"}, false},
		{"legacy vcodec", []string{"-i", "in.mkv", "-vcodec", "libx265", "-acodec", "copy", "-f", "mp4", "pipe:1"}, false},
		{"subtitle burn-in", []string{"-i", "in.mkv", "-filter_complex", "[0:v][0:s]overlay[v]", "-map", "[v]", "-c:v", "copy", "-c:a", "copy", "out.ts"}, false},
		{"scale filter", []string{"-i", "in.mkv", "-vf", "scale=-2:720", "-c:v", "copy", "-c:a", "copy", "out.ts"}, false},
		{"audio filter", []string{"-i", "in.mkv", "-af", "pan=stereo", "-c", "copy", "out.ts"}, false},
		{"implicit default encoders", []string{"-i", "in.mkv", "-f", "hls", "out.m3u8"}, false},
		{"video copied, audio implicit", []string{"-i", "in.mkv", "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy", "-f", "hls", "out.m3u8"}, false},
		{"stream index encoder", []string{"-i", "in.mkv", "-c:1", "aac", "-c", "copy", "out.ts"}, false},
	} {
		err := checkStreamCopyArgs(tc.args)
		if tc.ok && err != nil {
			t.Errorf("%s: checkStreamCopyArgs() = %v, want allowed", tc.name, err)
		}
		if !tc.ok && !errors.Is(err, ErrStreamCopyOnly) {
			t.Errorf("%s: checkStreamCopyArgs() = %v, want ErrStreamCopyOnly", tc.name, err)
		}
	}
}

// The guard only applies while the server disables transcoding.
func TestGuardStreamCopyArgsFollowsSetting(t *testing.T) {
	encode := []string{"-i", "in.mkv", "-c:v", "libx264", "-c:a", "aac", "out.ts"}
	t.Cleanup(func() { SetStreamCopyOnly(false) })

	SetStreamCopyOnly(false)
	if err := guardStreamCopyArgs(encode); err != nil {
		t.Fatalf("guard with transcoding enabled = %v, want nil", err)
	}
	SetStreamCopyOnly(true)
	if err := guardStreamCopyArgs(encode); !errors.Is(err, ErrStreamCopyOnly) {
		t.Fatalf("guard with transcoding disabled = %v, want ErrStreamCopyOnly", err)
	}
}
